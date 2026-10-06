"use strict";
// Pure parts of the dev-only token proxy (no I/O, unit tested with Jest).
// CommonJS on purpose: the package is "type": "module" but Jest runs CJS.
const path = require("node:path");

const DEFAULT_TTL_SECONDS = 60;
const DEFAULT_PORT = 8787;
const REQUIRED = ["MG_BASE_URL", "MG_USERNAME", "MG_PASSWORD", "MG_SDK_CERTIFICATE"];

const parseEnvFile = (text) => {
  const env = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      value.length >= 2 &&
      (value[0] === '"' || value[0] === "'") &&
      value[value.length - 1] === value[0]
    ) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
};

const positiveInt = (raw, fallback) => {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : fallback;
};

/** Throws naming the missing variables only: values are never echoed. */
const loadConfig = (env) => {
  const missing = REQUIRED.filter((k) => !env[k]);
  if (missing.length > 0) {
    throw new Error(`Missing required variables in server/.env.local: ${missing.join(", ")}`);
  }
  return {
    mgBaseUrl: env.MG_BASE_URL.replace(/\/+$/, ""),
    username: env.MG_USERNAME,
    password: env.MG_PASSWORD,
    sdkCertificate: env.MG_SDK_CERTIFICATE,
    // The docs do not define a token lifetime: this is an assumed value.
    tokenTtlSeconds: positiveInt(env.TOKEN_TTL_SECONDS, DEFAULT_TTL_SECONDS),
    port: positiveInt(env.PROXY_PORT, DEFAULT_PORT),
    camerasFile: env.CAMERAS_FILE || path.join(__dirname, "cameras.local.json")
  };
};

/** Media Gateway auth: Basic base64("username;sdkCertificate:password"). */
const buildBasicAuthHeader = ({ username, sdkCertificate, password }) =>
  `Basic ${Buffer.from(`${username};${sdkCertificate}:${password}`).toString("base64")}`;

const buildTokenUrl = (mgBaseUrl, externalId) =>
  `${mgBaseUrl}/media/v2/token/${encodeURIComponent(externalId)}`;

const findCamera = (cameras, id) =>
  typeof id === "string" ? cameras.find((c) => c.id === id) : undefined;

/**
 * Gateway status -> status for the browser. Never 401: the target app's
 * axios interceptor wipes the session on 401.
 */
const mapGatewayStatus = (status) => {
  if (status === 401 || status === 403) return 403;
  if (status === 404) return 404;
  return 502;
};

const buildTokenResponse = (token, ttlSeconds, mgBaseUrl, nowMs) => ({
  token,
  expiresAt: new Date(nowMs + ttlSeconds * 1000).toISOString(),
  mediaGatewayUrl: mgBaseUrl
});

const FETCH_TIMEOUT_MS = 10_000;

/** Framework-free router: returns { status, json }. Never logs or echoes secrets. */
const route = async ({ method, path: urlPath, body }, deps) => {
  const { config, loadCameras, fetchImpl, now } = deps;

  if (urlPath === "/api/genetec/cameras") {
    if (method !== "GET") return { status: 405, json: { message: "Method not allowed" } };
    try {
      return { status: 200, json: loadCameras() };
    } catch (e) {
      return { status: 500, json: { message: e.message } };
    }
  }

  if (urlPath === "/api/genetec/token") {
    if (method !== "POST") return { status: 405, json: { message: "Method not allowed" } };
    const cameraId = body && body.cameraId;
    if (typeof cameraId !== "string" || cameraId === "") {
      return { status: 400, json: { message: "cameraId is required" } };
    }
    let cameras;
    try {
      cameras = loadCameras();
    } catch (e) {
      return { status: 500, json: { message: e.message } };
    }
    const camera = findCamera(cameras, cameraId);
    if (!camera) return { status: 404, json: { message: "Unknown camera" } };

    try {
      const res = await fetchImpl(buildTokenUrl(config.mgBaseUrl, camera.externalId), {
        method: "GET",
        headers: { Authorization: buildBasicAuthHeader(config) },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
      });
      if (!res.ok) {
        return {
          status: mapGatewayStatus(res.status),
          json: { message: `Media Gateway responded ${res.status}` }
        };
      }
      const token = (await res.text()).trim();
      return {
        status: 200,
        json: buildTokenResponse(token, config.tokenTtlSeconds, config.mgBaseUrl, now())
      };
    } catch {
      // Error text may contain connection details: keep it out of the response.
      return { status: 502, json: { message: "Media Gateway unreachable" } };
    }
  }

  return { status: 404, json: { message: "Not found" } };
};

module.exports = {
  parseEnvFile,
  loadConfig,
  buildBasicAuthHeader,
  buildTokenUrl,
  findCamera,
  mapGatewayStatus,
  buildTokenResponse,
  route
};

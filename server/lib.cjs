"use strict";
// Pure parts of the dev-only token proxy (no sockets, unit tested with Jest).
// CommonJS on purpose: the package is "type": "module" but Jest runs CJS.
const path = require("node:path");
const ports = require("./dev-ports.json");

const DEFAULT_TTL_SECONDS = 60;
const DEFAULT_PORT = ports.proxyPort;
const REQUIRED = ["MG_BASE_URL", "MG_USERNAME", "MG_PASSWORD", "MG_SDK_CERTIFICATE"];
const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

/**
 * MG_BASE_URL must be an https origin (no credentials, path, query or hash).
 * Errors never echo the value: it may carry credentials.
 */
const parseMediaGatewayOrigin = (raw) => {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("MG_BASE_URL must be a valid URL, for example https://host:port");
  }
  if (url.protocol !== "https:") {
    throw new Error("MG_BASE_URL must use https:");
  }
  if (url.username || url.password) {
    throw new Error("MG_BASE_URL must not contain credentials");
  }
  if ((url.pathname !== "/" && url.pathname !== "") || url.search || url.hash) {
    throw new Error("MG_BASE_URL must be an origin only (https://host:port, no path, query or hash)");
  }
  return url.origin;
};

/** Origins allowed to call the proxy: Vite dev origins plus ALLOWED_ORIGINS (comma separated). */
const buildAllowedOrigins = (vitePort, extra) => [
  `http://localhost:${vitePort}`,
  `http://127.0.0.1:${vitePort}`,
  ...String(extra || "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean)
];

/** Throws naming the missing variables only: values are never echoed. */
const loadConfig = (env) => {
  const missing = REQUIRED.filter((k) => !env[k]);
  if (missing.length > 0) {
    throw new Error(`Missing required variables in server/.env.local: ${missing.join(", ")}`);
  }
  return {
    mgBaseUrl: parseMediaGatewayOrigin(env.MG_BASE_URL),
    username: env.MG_USERNAME,
    password: env.MG_PASSWORD,
    sdkCertificate: env.MG_SDK_CERTIFICATE,
    // The docs do not define a token lifetime: this is an assumed value.
    tokenTtlSeconds: positiveInt(env.TOKEN_TTL_SECONDS, DEFAULT_TTL_SECONDS),
    port: positiveInt(env.PROXY_PORT, DEFAULT_PORT),
    allowedOrigins: buildAllowedOrigins(ports.vitePort, env.ALLOWED_ORIGINS),
    camerasFile: env.CAMERAS_FILE || path.join(__dirname, "cameras.local.json")
  };
};

// ---- Request guards (the proxy holds SDK credentials: treat every caller as hostile) ----

/** Host must be exactly 127.0.0.1:<port> or localhost:<port> (blocks DNS rebinding). */
const isHostAllowed = (host, port) => {
  if (typeof host !== "string") return false;
  const h = host.toLowerCase();
  return h === `127.0.0.1:${port}` || h === `localhost:${port}`;
};

/** A missing/empty Origin is fine (curl, same-origin GET); a present one must be allowlisted. */
const isOriginAllowed = (origin, allowedOrigins) =>
  origin === undefined || origin === "" || allowedOrigins.includes(origin);

const hasJsonContentType = (contentType) =>
  typeof contentType === "string" &&
  contentType.split(";")[0].trim().toLowerCase() === "application/json";

/** Returns null when the request may proceed, otherwise { status, json }. */
const checkRequest = ({ method, host, origin, contentType }, { port, allowedOrigins }) => {
  if (!isHostAllowed(host, port)) {
    return { status: 403, json: { message: "Forbidden", code: "forbidden-host" } };
  }
  if (!isOriginAllowed(origin, allowedOrigins)) {
    return { status: 403, json: { message: "Forbidden", code: "forbidden-origin" } };
  }
  if (method === "POST" && !hasJsonContentType(contentType)) {
    return {
      status: 415,
      json: { message: "Content-Type must be application/json", code: "unsupported-media-type" }
    };
  }
  return null;
};

/** One line per request. Method, pathname (no query), status, duration: no tokens or credentials. */
const formatRequestLog = ({ method, path: urlPath, status, ms }) =>
  `${method} ${urlPath} ${status} ${Math.round(ms)}ms`;

// ---- Camera catalog ----

/** Validates the catalog shape. externalId ends up in a URL path: it must be a GUID. */
const validateCatalog = (cameras) => {
  if (!Array.isArray(cameras)) {
    throw new Error("Camera catalog must be a JSON array");
  }
  cameras.forEach((c, i) => {
    const label = c && typeof c.id === "string" ? c.id : `#${i}`;
    if (!c || typeof c.id !== "string" || c.id === "") {
      throw new Error(`Camera ${label}: id must be a non-empty string`);
    }
    if (typeof c.externalId !== "string" || !GUID_RE.test(c.externalId)) {
      throw new Error(`Camera ${label}: externalId must be a GUID`);
    }
  });
  return cameras;
};

/**
 * Cached catalog loader: re-parses (and re-validates) only when the file mtime
 * changes, so pasting new GUIDs needs no restart but requests do not re-read.
 */
const createCatalogLoader = (file, fsImpl) => {
  let cached = null;
  let cachedMtime = null;
  return () => {
    let mtimeMs;
    try {
      mtimeMs = fsImpl.statSync(file).mtimeMs;
    } catch {
      throw new Error(
        `Camera catalog not found: ${path.basename(file)}. Copy server/cameras.example.json to server/cameras.local.json.`
      );
    }
    if (cached && cachedMtime === mtimeMs) return cached;
    const parsed = validateCatalog(JSON.parse(fsImpl.readFileSync(file, "utf8")));
    cached = parsed;
    cachedMtime = mtimeMs;
    return cached;
  };
};

// ---- Gateway ----

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

const gatewayErrorCode = (status) => {
  if (status === 401 || status === 403) return "forbidden-upstream";
  if (status === 404) return "upstream-not-found";
  return "upstream-error";
};

const buildTokenResponse = (token, ttlSeconds, mgBaseUrl, nowMs) => ({
  token,
  expiresAt: new Date(nowMs + ttlSeconds * 1000).toISOString(),
  mediaGatewayUrl: mgBaseUrl
});

const FETCH_TIMEOUT_MS = 10_000;

const INTERNAL_ERROR = {
  status: 500,
  json: { message: "Internal error", code: "internal-error" }
};

/** Framework-free router: returns { status, json }. Never logs or echoes secrets. */
const route = async ({ method, path: urlPath, body }, deps) => {
  const { config, loadCameras, fetchImpl, now, logError = () => {} } = deps;

  // Details stay in the local log; the response body is generic.
  const internalError = (e) => {
    logError(e && e.message ? e.message : String(e));
    return INTERNAL_ERROR;
  };

  if (urlPath === "/api/genetec/cameras") {
    if (method !== "GET") return { status: 405, json: { message: "Method not allowed" } };
    try {
      return { status: 200, json: loadCameras() };
    } catch (e) {
      return internalError(e);
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
      return internalError(e);
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
          json: {
            message: `Media Gateway responded ${res.status}`,
            code: gatewayErrorCode(res.status)
          }
        };
      }
      const token = (await res.text()).trim();
      return {
        status: 200,
        json: buildTokenResponse(token, config.tokenTtlSeconds, config.mgBaseUrl, now())
      };
    } catch (e) {
      // Error text may contain connection details: keep it out of the response.
      if (e && (e.name === "TimeoutError" || e.name === "AbortError")) {
        return {
          status: 504,
          json: { message: "Media Gateway timed out", code: "upstream-timeout" }
        };
      }
      return {
        status: 502,
        json: { message: "Media Gateway unreachable", code: "upstream-unreachable" }
      };
    }
  }

  return { status: 404, json: { message: "Not found" } };
};

// ---- HTTP handler (no sockets created here: req/res are injected, unit tested) ----

const DEFAULT_MAX_BODY_BYTES = 10_000;

/** Pathname of a request target, or null when it cannot be parsed (for example "//"). */
const parseRequestPath = (rawUrl) => {
  try {
    return new URL(rawUrl || "/", "http://127.0.0.1").pathname;
  } catch {
    return null;
  }
};

class BodyTooLargeError extends Error {}

/** Reads a JSON body. Rejects with BodyTooLargeError past the limit WITHOUT touching the socket. */
const readBody = (req, maxBytes) =>
  new Promise((resolve, reject) => {
    let size = 0;
    let settled = false;
    const chunks = [];
    req.on("data", (chunk) => {
      if (settled) return;
      size += chunk.length;
      if (size > maxBytes) {
        settled = true;
        reject(new BodyTooLargeError("Body too large"));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (settled) return;
      settled = true;
      const text = Buffer.concat(chunks).toString("utf8");
      if (!text) return resolve(undefined);
      try {
        resolve(JSON.parse(text));
      } catch {
        resolve(undefined);
      }
    });
    req.on("error", (e) => {
      if (settled) return;
      settled = true;
      reject(e);
    });
  });

/**
 * Builds the (req, res) handler. The returned function never rejects: anything
 * unexpected becomes a generic 500, so the process cannot die on an unhandled rejection.
 */
const createRequestHandler = ({ config, loadCameras, fetchImpl, now, logError, log }) => {
  const maxBodyBytes = config.maxBodyBytes || DEFAULT_MAX_BODY_BYTES;

  const handle = async (req, res) => {
    const startedAt = now();
    let urlPath = "-";
    const send = (status, json, { close = false, onDone } = {}) => {
      res.writeHead(status, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
        ...(close ? { Connection: "close" } : {})
      });
      res.end(JSON.stringify(json), onDone);
      log(formatRequestLog({ method: req.method, path: urlPath, status, ms: now() - startedAt }));
    };

    const parsed = parseRequestPath(req.url);
    if (parsed === null) {
      return send(400, { message: "Bad request", code: "bad-request" });
    }
    urlPath = parsed;

    try {
      const blocked = checkRequest(
        {
          method: req.method,
          host: req.headers.host,
          origin: req.headers.origin,
          contentType: req.headers["content-type"]
        },
        config
      );
      if (blocked) return send(blocked.status, blocked.json);

      const body = req.method === "POST" ? await readBody(req, maxBodyBytes) : undefined;
      const { status, json } = await route(
        { method: req.method, path: urlPath, body },
        { config, loadCameras, fetchImpl, now, logError }
      );
      send(status, json);
    } catch (e) {
      if (e instanceof BodyTooLargeError) {
        // Answer first, then stop the upload: writing to a destroyed socket loses the 413.
        return send(
          413,
          { message: "Payload too large", code: "payload-too-large" },
          { close: true, onDone: () => req.destroy() }
        );
      }
      logError(e && e.message ? e.message : String(e));
      send(500, INTERNAL_ERROR.json);
    }
  };

  return async (req, res) => {
    try {
      await handle(req, res);
    } catch (e) {
      try {
        logError(e && e.message ? e.message : String(e));
        res.writeHead(500, { "Content-Type": "application/json", "Cache-Control": "no-store" });
        res.end(JSON.stringify(INTERNAL_ERROR.json));
      } catch {
        // Response already broken: nothing left to do, and we must not reject.
      }
    }
  };
};

module.exports = {
  parseRequestPath,
  createRequestHandler,
  parseEnvFile,
  loadConfig,
  parseMediaGatewayOrigin,
  buildAllowedOrigins,
  isHostAllowed,
  isOriginAllowed,
  hasJsonContentType,
  checkRequest,
  formatRequestLog,
  validateCatalog,
  createCatalogLoader,
  buildBasicAuthHeader,
  buildTokenUrl,
  findCamera,
  mapGatewayStatus,
  buildTokenResponse,
  route
};

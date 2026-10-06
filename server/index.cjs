"use strict";
// Dev-only Genetec token proxy. Binds to 127.0.0.1. Run: pnpm proxy
// Self-signed Media Gateway certificate? Use NODE_EXTRA_CA_CERTS=<ca.pem>.
// Never disable TLS verification.
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { parseEnvFile, loadConfig, route } = require("./lib.cjs");

const ENV_FILE = path.join(__dirname, ".env.local");
const MAX_BODY_BYTES = 10_000;

const readEnv = () => {
  if (!fs.existsSync(ENV_FILE)) {
    throw new Error("server/.env.local not found. Copy server/.env.example and fill it in.");
  }
  return parseEnvFile(fs.readFileSync(ENV_FILE, "utf8"));
};

const readBody = (req) =>
  new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("Body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8");
      if (!text) return resolve(undefined);
      try {
        resolve(JSON.parse(text));
      } catch {
        resolve(undefined);
      }
    });
    req.on("error", reject);
  });

const main = () => {
  const config = loadConfig(readEnv());

  // Re-read on every request so pasting new GUIDs needs no restart.
  const loadCameras = () => {
    if (!fs.existsSync(config.camerasFile)) {
      throw new Error(
        `Camera catalog not found: ${path.basename(config.camerasFile)}. Copy server/cameras.example.json to server/cameras.local.json.`
      );
    }
    return JSON.parse(fs.readFileSync(config.camerasFile, "utf8"));
  };

  const server = http.createServer(async (req, res) => {
    try {
      const urlPath = new URL(req.url || "/", "http://127.0.0.1").pathname;
      const body = req.method === "POST" ? await readBody(req) : undefined;
      const { status, json } = await route(
        { method: req.method, path: urlPath, body },
        { config, loadCameras, fetchImpl: fetch, now: Date.now }
      );
      res.writeHead(status, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store"
      });
      res.end(JSON.stringify(json));
    } catch {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ message: "Proxy error" }));
    }
  });

  server.listen(config.port, "127.0.0.1", () => {
    // Only non-secret facts are logged.
    console.log(`Genetec token proxy listening on http://127.0.0.1:${config.port}`);
    console.log(`Media Gateway: ${config.mgBaseUrl} | assumed token TTL: ${config.tokenTtlSeconds}s`);
  });
};

try {
  main();
} catch (e) {
  console.error(e.message);
  process.exit(1);
}

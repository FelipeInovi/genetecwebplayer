"use strict";
// Dev-only Genetec token proxy. Binds to 127.0.0.1. Run: pnpm proxy
// Self-signed Media Gateway certificate? Use NODE_EXTRA_CA_CERTS=<ca.pem>.
// Never disable TLS verification.
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const {
  parseEnvFile,
  loadConfig,
  createRequestHandler,
  createCatalogLoader
} = require("./lib.cjs");

const ENV_FILE = path.join(__dirname, ".env.local");
const MAX_BODY_BYTES = 10_000;

const readEnv = () => {
  if (!fs.existsSync(ENV_FILE)) {
    throw new Error("server/.env.local not found. Copy server/.env.example and fill it in.");
  }
  return parseEnvFile(fs.readFileSync(ENV_FILE, "utf8"));
};

const logError = (message) => console.error(`[proxy] ${message}`);

const main = () => {
  const config = loadConfig(readEnv());
  // Cached by file mtime: pasting new GUIDs needs no restart, requests do not re-parse.
  const loadCameras = createCatalogLoader(config.camerasFile, fs);

  const server = http.createServer(
    createRequestHandler({
      config: { ...config, maxBodyBytes: MAX_BODY_BYTES },
      loadCameras,
      fetchImpl: fetch,
      now: Date.now,
      logError,
      log: console.log
    })
  );

  server.listen(config.port, "127.0.0.1", () => {
    // Only non-secret facts are logged.
    console.log(`Genetec token proxy listening on http://127.0.0.1:${config.port}`);
    console.log(`Media Gateway: ${config.mgBaseUrl} | assumed token TTL: ${config.tokenTtlSeconds}s`);
    console.log(`Allowed origins: ${config.allowedOrigins.join(", ")}`);
  });
};

try {
  main();
} catch (e) {
  console.error(e.message);
  process.exit(1);
}

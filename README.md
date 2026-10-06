# Genetec Web Player (GWP) proof of concept

Local POC for showing Genetec cameras (1 to 32 simultaneous streams) through
the Genetec Web Player. The feature module (`src/render/pages/Genetec`,
`service/genetec`, `types/genetec.ts`) is built to be copied into
`broadlineavida`.

## Setup

```bash
pnpm i
cp .env.example .env.local
pnpm dev
```

Scripts: `dev`, `proxy`, `build`, `preview`, `test`, `lint`, `type-check`.

## Bearer token

There is no login. The token resolves as:

1. `localStorage.accessToken`
2. `VITE_DEV_BEARER_TOKEN` from `.env.local`

```js
localStorage.setItem("accessToken", "<token>");
```

A 401 maps to `TokenExpiredError` (UI: "Bearer token expired, update it") and
never clears storage. A 403 maps to `GenetecForbiddenError`.

`VITE_` variables are inlined into the bundle: never build with a real token.

## Modes

| Variable | Values | Effect |
| --- | --- | --- |
| `VITE_USE_MOCK_API` | `true` / `false` | `true`: fixtures (32 cameras around Medellin, fake 5 min token). `false`: calls `GET /genetec/cameras` and `POST /genetec/token`. |
| `VITE_GENETEC_PLAYER_MODE` | `mock` / `gwp` | `mock`: canvas test pattern. `gwp`: loads `<MG>/media/v2/files/gwp.js` and uses the real player. |
| `VITE_MEDIA_GATEWAY_URL` | URL | Media Gateway used by `gwp` mode. |

SDK credentials and certificates never reach the browser: the token only comes
from our backend.

`VITE_MEDIA_GATEWAY_URL` is the BASE URL (`https://host:port`). The app derives
the GWP endpoint once with `getMediaEndpoint(base)` => `${base}/media`, used for
both the script (`${endpoint}/v2/files/gwp.js`) and `start()`.

## Live test setup (real Media Gateway)

1. The browser must trust the Media Gateway certificate, and the gateway must
   allow the Vite origin (`http://localhost:3000`) in `MediaGateway.gconfig`
   (`AllowedOrigin`) or run with `EnforceStrictCrossOrigin="false"` (dev only).
2. `cp server/.env.example server/.env.local` and fill `MG_BASE_URL`,
   `MG_USERNAME`, `MG_PASSWORD`, `MG_SDK_CERTIFICATE`. Optional:
   `TOKEN_TTL_SECONDS` (default 60, assumed: the docs define no lifetime),
   `PROXY_PORT` (8787), `CAMERAS_FILE`.
3. `cp server/cameras.example.json server/cameras.local.json` and paste the real
   camera GUIDs (`externalId`; `id` is any stable string). Gitignored.
4. If the gateway uses a self-signed certificate, start the proxy with
   `NODE_EXTRA_CA_CERTS=/path/to/gateway-ca.pem pnpm proxy`. Never disable TLS
   verification.
5. `pnpm proxy` (binds to 127.0.0.1 only; secrets and tokens are never logged).
6. In `.env.local`: `VITE_API_URL=` (empty), `VITE_USE_MOCK_API=false`,
   `VITE_GENETEC_PLAYER_MODE=gwp`, `VITE_MEDIA_GATEWAY_URL=https://host:port`.
7. `pnpm dev`. Vite proxies `/api` to the token proxy.

Proxy endpoints: `GET /api/genetec/cameras` (catalog) and
`POST /api/genetec/token {cameraId}` => `{ token, expiresAt, mediaGatewayUrl }`.
Gateway 401/403 is returned as 403 (a 401 would wipe the session in the target
app). `expiresAt` is `now + TOKEN_TTL_SECONDS`.

Checklist: [ ] proxy up and `curl 127.0.0.1:8787/api/genetec/cameras` lists
cameras; [ ] `gwp.js` loads (Network tab); [ ] 1 camera plays; [ ] run the
phases 1/4/8/16/32 individual, then multiplexed; [ ] export CSV after each run.

Tokens: the frontend `createTokenRetriever` caches per camera GUID (what GWP
passes; mapped to our camera id for the backend), refreshes 15 s before
`expiresAt`, shares in-flight requests and never caches failures.

## Metrics and CSV

The test panel (top of the page) picks camera count (1/4/8/16/32) and the
multiplexed toggle. "Start phase" remounts the mosaic (so first-frame times
belong to the phase) and polls `getPlayerStats()` of every live player every
1 s (mock players generate plausible fake stats). "Stop phase" ends it. The
debug overlay switch calls `showDebugOverlay` on every player.

"Export CSV" downloads two files: `genetec-samples-*.csv` (raw per-camera
samples) and `genetec-summary-*.csv` (one row per phase: avg/p95/max latency,
avg fps, total bandwidth = sum of per-camera average bitrate, packets lost and
frames dropped, first-frame times, error and reconnection counts).

Reconnection rule: per camera, stream status `-1` (ConnectingToMediaGateway)
after the camera already reached `5` (Streaming), followed by `5` again. The
initial connect does not count.

## Multiplexed vs individual

- Individual (default): each cell calls `player.start(guid, endpoint, tokenRetriever)`.
- Multiplexed: one `gwp.buildMediaGatewayService(endpoint, tokenRetriever)` per
  mosaic, shared through React context; cells call `startWithService`. The
  service is released when the mosaic unmounts or the mode changes.

## Migration map to broadlineavida

| POC | broadlineavida |
| --- | --- |
| `src/render/pages/Genetec/**` | `src/render/pages/Genetec/**` (lazy-route it) |
| `src/render/service/genetec/**` | `src/render/service/genetec/**` |
| `src/render/service/errors.ts` | `src/render/service/errors.ts` |
| `src/render/types/genetec.ts` | `src/render/types/genetec.ts` |
| `src/render/service/apiLV.ts` | not copied: use the existing `apiLVl.ts` (change import in `genetecService.ts`; handle 401/403 mapping there or in the hooks) |
| `src/render/config/poc.config.ts` | tenant config (`mv.config.ts`): `genetecEnabled`, `mediaGatewayUrl` |
| `src/render/locales/translations/*.json` `genetec` section | merge into the global `es/en/fr.json` |
| `src/render/config/env.ts` | drop; read `import.meta.env` directly |

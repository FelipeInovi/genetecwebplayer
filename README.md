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

`VITE_DEV_BEARER_TOKEN` is honored only by the dev server
(`import.meta.env.DEV`). `vite build` fails in ANY mode (staging, development, custom) if it is set,
because `VITE_` variables are inlined into the bundle. Unset it before building.

## Modes

| Variable | Values | Effect |
| --- | --- | --- |
| `VITE_USE_MOCK_API` | `true` / `false` | `true`: fixtures (32 cameras around Medellin, fake 5 min token). `false`: calls `GET /genetec/cameras` and `POST /genetec/token`. |
| `VITE_GENETEC_PLAYER_MODE` | `mock` / `gwp` | `mock`: canvas test pattern. `gwp`: loads `<MG>/media/v2/files/gwp.js` and uses the real player. |
| `VITE_MEDIA_GATEWAY_URL` | URL | Media Gateway used by `gwp` mode. |
| `VITE_START_TIMEOUT_MS` | ms (optional) | Start deadline per cell, default `30000` (`startTimeoutMs` in `poc.config.ts`). New variable: add it to `.env.example` if you want it documented there. |

Start timeout: each cell has a deadline covering token + `start()` + the first
`Streaming` status. On expiry the cell fails with source `start-timeout` (it is
recorded in the metrics) and the player is stopped and disposed.

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
   `PROXY_PORT` (8787), `CAMERAS_FILE`, `ALLOWED_ORIGINS` (comma separated
   extra origins; the Vite dev origins `http://localhost:3000` and
   `http://127.0.0.1:3000` are always allowed). `MG_BASE_URL` must be an
   `https:` origin only (no credentials, path or query). Ports live in
   `server/dev-ports.json`, shared by `vite.config.ts` and the proxy
   (`strictPort` is on so the Vite origin never drifts).
3. `cp server/cameras.example.json server/cameras.local.json` and paste the real
   camera GUIDs (`externalId`; `id` is any stable string). Gitignored.
4. If the gateway uses a self-signed certificate, start the proxy with
   `NODE_EXTRA_CA_CERTS=/path/to/gateway-ca.pem pnpm proxy`. Never disable TLS
   verification.
5. `pnpm proxy` (binds to 127.0.0.1 only; secrets and tokens are never logged).
6. In `.env.local`: `VITE_API_URL=` (empty), `VITE_USE_MOCK_API=false`,
   `VITE_GENETEC_PLAYER_MODE=gwp`, `VITE_MEDIA_GATEWAY_URL=https://host:port`.
7. `pnpm dev`. Vite proxies `/api` to the token proxy.

Proxy hardening: the Host header must be `127.0.0.1:<port>` or
`localhost:<port>` (403 `forbidden-host` otherwise); a non-empty `Origin` must
be allowlisted (403 `forbidden-origin`); `POST` requires
`Content-Type: application/json` (415). The camera catalog is cached and
reloaded when the file mtime changes; every `externalId` must be a GUID. Each
request logs one line (`METHOD path status ms`), never tokens or credentials.

Error JSON bodies carry a `code`: 403 `forbidden-upstream` (gateway 401/403),
400 `bad-request` (unparseable request target), 413 `payload-too-large`
(sent before the connection is closed), 504 `upstream-timeout`, 502 `upstream-unreachable` (network), 502
`upstream-error` (other gateway failures), 404 `upstream-not-found`, 500
`internal-error` (generic body; details only in the local log).

Proxy endpoints: `GET /api/genetec/cameras` (catalog) and
`POST /api/genetec/token {cameraId}` => `{ token, expiresAt, mediaGatewayUrl }`.
Gateway 401/403 is returned as 403 (a 401 would wipe the session in the target
app). `expiresAt` is `now + TOKEN_TTL_SECONDS`.

Checklist: [ ] proxy up and `curl 127.0.0.1:8787/api/genetec/cameras` lists
cameras; [ ] `gwp.js` loads (Network tab); [ ] 1 camera plays; [ ] run the
phases 1/4/8/16/32 individual, then multiplexed; [ ] export CSV after each run.

Tokens: the frontend `createTokenRetriever` caches per camera GUID (what GWP
passes; mapped to our camera id for the backend), refreshes 15 s before
`expiresAt` plus a random 0..10 s per camera (avoids renewal bursts), shares
in-flight requests, runs at most 4 backend fetches at once (the rest queue),
retries once-twice (500 ms then 1500 ms) on network errors and 502/503/504
(never on 403) and never caches failures. Individual and multiplexed mode use
the same retriever path. A renewal failure after the cell reached `Streaming`
is recorded as `token-renewal` and rethrown to GWP, but the cell keeps
playing; only failures before the first `Streaming` fail the cell.

## Selecting cameras

The mosaic shows one camera per cell, chosen from the whole catalog (it is NOT
"the first N cameras"). The cell count comes from the test panel (1/4/8/16/32).
At start the cells show cameras 1..N.

- Click a cell to select it (outlined), then click a camera in the list on the
  left to show it there. Cells and list items are buttons, so Tab + Enter/Space
  works without a mouse.
- Or drag a camera from the list onto a cell (`@dnd-kit/core`). Dragging a
  filled cell onto another one moves/swaps its camera.
- A camera is never in two cells: assigning one that is already displayed swaps
  the two cells. The small x of a cell empties it (placeholder, no session).
- "Previous group" / "Next group" move through the catalog N cameras at a time,
  wrapping around (32 cameras, 4 cells: 1-4, 5-8 ... 29-32, 1-4). The label reads
  "Cameras 5-8 of 32" for a contiguous group and "Custom selection" otherwise.
  A catalog that is not a multiple of N ends with a PARTIAL group (10 cameras,
  4 cells: 9-10 plus two empty cells); cameras are never repeated to fill it.
  Groups advance from the first displayed camera, so a manual pick shifts the
  grouping from there.
- Changing the cell count keeps your picks, truncates, and fills empty cells
  with cameras that are not displayed yet.
- The search box filters the list by name; each item shows online/offline and
  the cell that displays it.

Gateway session limit: every filled cell holds one Media Gateway session. If
the gateway allows e.g. 4 concurrent sessions, use 4 cells and page through the
catalog: a cell whose camera changes is fully released (`stop()` + `dispose()`,
stats source unregistered) BEFORE the new camera starts, and cells whose camera
did not change are not restarted. With cells above the limit, the extra ones
fail with the gateway error (e.g. `LiveCapacityExceeded`, `TooManyClients`) and
show it in the cell; free sessions by clearing cells or lowering the count.
Multiplexed mode keeps one shared service and every cell still calls
`startWithService`; changing a camera does not rebuild the service.

During a phase, every camera change is recorded as a `camera-assigned` event
(columns `cellIndex` and `previousCameraId` of the events CSV; `cameraId` is the
NEW camera; clears and changes outside a phase are not recorded), so a CSV
shows when a group was swapped mid-test. These events do not count as errors
nor as cameras that never streamed.

## Metrics and CSV

The test panel (top of the page) picks camera count (1/4/8/16/32) and the
multiplexed toggle (kept as page state, not in the stats store). "Start phase" remounts the mosaic (so first-frame times
belong to the phase) and polls `getPlayerStats()` of every live player every
1 s (mock players generate plausible fake stats). "Stop phase" ends it. The
debug overlay switch calls `showDebugOverlay` on every player.

"Export CSV" downloads three files: `genetec-samples-*.csv` (raw per-camera
samples), `genetec-events-*.csv` (one row per event: `ts, seq, phaseId,
cameraId, kind, source, code, isFatal, status, cellIndex, previousCameraId`;
`status` is the stream status of `streamStatus` events, `code` the error code
of the others, the last two only exist for `camera-assigned` events; free-text messages
are not exported and text fields starting with `= + - @` get a leading `'`) and
`genetec-summary-*.csv` (one row per phase: avg/p95/max latency,
avg fps, total bandwidth = sum of per-camera average bitrate, packets lost and
frames dropped, first-frame times, error and reconnection counts).

Metric definitions:

- Packets lost / frames dropped: per camera, the sum of positive deltas between
  consecutive samples (the first reading counts from zero). A decrease means a
  counter reset (player rebuilt): the new value is added. `[5, 9, 0, 3]` => 12.
  Totals sum across cameras.
- Reconnection: per camera, stream status `-1` (ConnectingToMediaGateway) after
  the camera already reached `5` (Streaming), followed by `5` again. The initial
  connect does not count; consecutive `-1`s count once.
- `camerasNeverStreamed`: cells that started (or failed) in the phase but never
  reached `Streaming`. `camerasEndedDisconnected`: cells that streamed at least
  once and whose last status was not `Streaming` (unrecovered drop).
- Time to first streaming: first `Streaming` minus the cell's `start-requested`
  event, aggregated across cells.
- Errors: every failure is an `error` event with `cameraId`, `phase` and a
  stable `source`: `script-load`, `token`, `token-renewal`, `start`,
  `start-timeout`, `fatal-status`, `service-build`, `offline`, `gwp-error`.
- `statsReadFailures`: `getPlayerStats()` reads that failed or exceeded 800 ms
  during the phase. A poll tick is skipped while the previous one still runs.

Performance: raw samples and events live in module-level arrays (not React
state); the UI only receives derived counters (samples, errors, reconnections),
updated at most once per tick. The CSV export and phase summaries read the raw
data on demand. Leaving the page stops the active phase and its polling timer.

## Multiplexed vs individual

- Individual (default): each cell calls `player.start(guid, endpoint, tokenRetriever)`.
- Multiplexed: one `gwp.buildMediaGatewayService(endpoint, tokenRetriever)` per
  mosaic, shared through React context; cells call `startWithService`. The
  service is released when the mosaic unmounts or the mode changes.

## Architecture

The player feature is decoupled from the load-test tooling through one
optional seam, `GenetecPlayerTelemetry` (`types/genetec.ts`): `onStartRequested`,
`onError`, `onStreamStatus` and `registerStatsSource` (returns its unregister
function), plus the optional `onCameraAssigned` (emitted by the page, which owns
the assignment, not by the player). It is provided through `GenetecTelemetryContext` and defaults to a
no-op, so the player hooks and components never import `stats/`. Only
`GenetecPage` (the test harness) provides the real implementation
(`stats/statsTelemetry.ts`). UI settings of the harness (camera count,
multiplexed, debug overlay) are page state; the debug overlay reaches the
players through `GenetecServiceContext`.

- `hooks/cellAssignment.ts`: pure model of cell -> camera id (create, resize,
  assign with swap, clear, next/previous group, range label, diff);
  `hooks/useCellAssignment.ts`: page state around it (+ selected cell).
- `components/GenetecCameraList.tsx` (searchable, draggable list),
  `GenetecMosaicCell.tsx` (drop target + select + clear), `GenetecGroupNav.tsx`,
  `resolveDrop.ts` (what a drag-end means).
- `hooks/useGenetecPlayer.ts`: thin hook (reducer + one effect).
- `hooks/playerReducer.ts`: `idle | loading | playing | error` state machine.
- `hooks/playerSession.ts`: lifecycle of one start attempt (`cancelled || failed`
  guard, idempotent release, deadline).
- `hooks/attachPlayer.ts`: `attachGwpPlayer` and `attachMockPlayer`.
- `stats/statsCollector.ts`: plain module (player registry, polling, raw arrays);
  `stats/statsStore.ts`: zustand store with phase lifecycle and derived counters.

Mock branches are marked with a single `// POC-only:` comment convention.

## Migration map to broadlineavida

Target conventions: feature-flat (`pages/`, `components/`, `service/`, `types/`,
`config/`), no DDD layers, services are plain typed async functions on the shared
axios instance consumed through TanStack Query. The telemetry provider is
OPTIONAL in the target: without it the player runs with the no-op default.

### Migrate

| POC source | broadlineavida target |
| --- | --- |
| `src/render/pages/Genetec/components/GenetecMosaic.tsx`, `GenetecMosaicCell.tsx`, `GenetecPlayerCell.tsx`, `GenetecServiceContext.ts`, `GenetecTelemetryContext.ts`, `getGridColumns.ts` (+ tests) | `src/render/pages/Genetec/components/` |
| `src/render/pages/Genetec/components/{GenetecCameraList.tsx,GenetecGroupNav.tsx,resolveDrop.ts}` (+ tests) | `src/render/pages/Genetec/components/`. broadlineavida already has a CCTV pattern (`pages/CCTV/components/{CCTVCameraDragList,CCTVMosaic,MosaicCell}.tsx`, `CCTVContext`) built on the same `@dnd-kit/core` (`^6.3.1`, already a dependency there): the camera list can be replaced by or merged with `CCTVCameraDragList`; keep `resolveDrop` + `cellAssignment` for the group paging and swap rules |
| `src/render/pages/Genetec/hooks/{cellAssignment,useCellAssignment}.ts` (+ tests) | `src/render/pages/Genetec/hooks/` (pure, no dependencies; new dependency `@dnd-kit/core` only for the list/cells) |
| `src/render/pages/Genetec/hooks/{useGenetecPlayer,playerReducer,playerSession,attachPlayer,instrumentTokenRetriever,streamedCameras,loadGwpScript,useMediaGatewayService,useGenetecCameras}.ts` (+ tests) | `src/render/pages/Genetec/hooks/` |
| `src/render/pages/Genetec/GenetecPage.tsx` | `src/render/pages/Genetec/GenetecPage.tsx`, trimmed: keep camera list, loading/error alerts, title and `GenetecMosaic`; drop `GenetecTestPanel`, the telemetry provider, test-config state and `runKey`; keep `useCellAssignment`, the camera list, the group nav and the `DndContext` (set the cell count from a layout selector instead of the test panel; drop the `camera-assigned` reporting effect) |
| `src/render/service/genetec/{genetecService,mediaEndpoint,tokenRetriever}.ts` (+ tests) | `src/render/service/genetec/`; in `genetecService.ts` import `apiLV` from `service/apiLVl.ts` and delete the `// POC-only:` mock branches |
| `src/render/service/errors.ts` (`TokenExpiredError`, `GenetecForbiddenError`, `GwpPlayerError`, `CameraOfflineError`, `toError`) | `src/render/service/errors.ts` (merge with existing exports) |
| `src/render/types/genetec.ts` | `src/render/types/genetec.ts` (split into `types/genetec*.ts` if preferred) |
| `src/render/config/poc.config.ts` fields | add to `config/<tenant>.config.ts`: `genetecEnabled`, `mediaGatewayUrl`, `startTimeoutMs` (default 30000); `genetecPlayerMode` and `useMockApi` only if the mock player is kept. `attachPlayer.ts`, `useGenetecPlayer.ts` and `useMediaGatewayService.ts` import the POC config: point them to the tenant config |
| `genetec` section of `src/render/locales/translations/{es,en,fr}.json`: `title`, `cameraCount`, `disabled`, `player.loading`, `errors.*`, `mosaic.*`, `cameraList.*`, `group.*` | `src/render/locales/translations/{es,en,fr}.json` (do NOT copy `genetec.test.*`; copy `genetec.mode` only if the page keeps the mode line) |
| route | `routes/LazyPages.tsx` (lazy `GenetecPage`) and `routes/AppRoutes.tsx` wrapped in `RouteAccess` with `allowedProjects={["MV"]}` |
| navigation | `components/Header/BtnsHeader.tsx` |

Backend contract: `GET /genetec/cameras` and `POST /genetec/token`. Use
broadlineavida's `apiLV` from `service/apiLVl.ts`, not the POC `apiLV`. Its 401
interceptor wipes the session, so the backend MUST return 403 (not 401) for
Genetec access errors (the POC proxy already does this: gateway 401/403 => 403).

### Do NOT migrate (POC-only)

| POC path | Why |
| --- | --- |
| `server/` | local token proxy for the live test |
| `src/render/pages/Genetec/stats/**` (collector, store, telemetry, metrics, csv) | load-test tooling; also `types/genetecMetrics.ts` |
| `src/render/pages/Genetec/components/GenetecTestPanel.tsx` (+ test) | load-test UI |
| `src/render/pages/Genetec/components/MockPlayer.tsx` (+ test) | canvas simulator; OPTIONAL: keep it (with `attachMockPlayer` and `genetecPlayerMode`) only if a mock mode is wanted in the target, otherwise delete it and the mock branch in `useGenetecPlayer.ts`/`useMediaGatewayService.ts` |
| `src/render/service/genetec/mocks.ts` | mock cameras/tokens |
| `src/render/config/buildGuard.ts`, `devToken.ts`, `env.ts` | dev bearer token plumbing; read `import.meta.env` directly if needed |
| `src/render/service/apiLV.ts` | replaced by broadlineavida's `apiLVl.ts` |
| `src/test/envStub.ts`, `.env.example`, `docs/genetec/` | harness and notes |

## Open verification items (needs real gwp.d.ts)

The GWP typings are hand-written from the docs. Check each against
`<MG>/media/v2/files/gwp.d.ts` once a real Media Gateway is available:

| Location | Open question |
| --- | --- |
| `types/genetec.ts` (GWP typings header) | Whole hand-written GWP typing set |
| `types/genetec.ts` `StreamingConnectionStatus` | Documented values only; the wiki table is incomplete |
| `types/genetec.ts` `GwpTimeSpan` | TimeSpan representation is not documented |
| `types/genetec.ts` `IPlayerStats` | Field types of the numeric/nullable fields |
| `types/genetec.ts` `IMediaGatewayService.dispose` | No documented dispose; called defensively if present |
| `types/genetec.ts` `GwpPlayer.getPlayerStats` | Documented as `Promise<IPlayerStats>` (original brief assumed sync) |
| `stats/metrics.ts` `timeSpanToMs` | Accepts several plausible shapes; numbers assumed to be ms |
| `hooks/useMediaGatewayService.ts` `disposeService` | Same optional `dispose` as above |

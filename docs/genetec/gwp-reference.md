# Genetec Web Player (GWP) Reference

Compiled from the Genetec DAP wiki (page "API Reference" last updated 2026-09-12). Sources:

- DEV: https://github.com/Genetec/DAP/wiki/gwp-developer-guide
- API: https://github.com/Genetec/DAP/wiki/gwp-api-reference
- TRB: https://github.com/Genetec/DAP/wiki/gwp-troubleshooting
- MUX: https://github.com/Genetec/DAP/wiki/gwp-multiplexing-sample
- APP: https://github.com/Genetec/DAP/wiki/gwp-sample-application
- MGW: https://github.com/Genetec/DAP/wiki/media-gateway-developer-guide
- SMP: https://github.com/Genetec/DAP/tree/main/Samples/Genetec%20Web%20Player (GwpDesktopPlayerSample, GwpMinimalApiSample, GwpRazorPagesSample)

Caveat: pages were read through a summarizing fetch tool (the raw wiki git clone was blocked). Names, signatures and tables are reliable enough for planning, but verify against the authoritative `gwp.d.ts` served by the target Media Gateway (`https://<MG>/media/v2/files/gwp.d.ts`) before finalizing typings. Items marked NOT DOCUMENTED were searched for and absent.

## 1. Loading gwp.js and version compatibility (DEV, TRB)

- Script URL: `https://<MediaGatewayAddress>/media/v2/files/gwp.js` (types: `.../media/v2/files/gwp.d.ts`).
- Always load from the same Media Gateway used for tokens and streaming. Never self-host or mix versions. Cross-version compatibility is NOT guaranteed. Failover to another gateway does not reload gwp.js.
- Check with `gwp.version()`. Cache-bust with `gwp.js?v=<x>` or hard refresh after Security Center upgrades.
- The "endpoint" passed to `start()` / `buildMediaGatewayService()` is the application path, e.g. `https://host:8443/media`. WSS URL derived as `wss://host:8443/media/v2/ws`; the HTTPS port is preserved; port 80 is not needed.
- GWP vs Media Gateway vs Security Center compatibility matrix: NOT DOCUMENTED. Only rule: GWP build must come from the gateway. The samples carry a `MediaGateway.ServerVersion` setting and `start()` accepts an optional `serverVersion` arg (semantics not explained).
- Browser requirements: modern Chrome/Firefox/Edge/Safari. Transport is WebSocket + Media Source Extensions; decoding is in the browser (hardware acceleration where available).

## 2. Global API `gwp` (API)

| Member | Signature |
|---|---|
| buildPlayer | `(container: HTMLDivElement) => IWebPlayer` |
| buildMediaGatewayService | `(url: string, tokenRetriever: TokenRetrieverFct) => Promise<IMediaGatewayService>` |
| enableLogs | `(intense?: boolean) => string` (logs prefixed with a hamster emoji; intense hurts performance) |
| disableLogs | `() => string` |
| version | `() => string` |

`TokenRetrieverFct = (camera: string) => Promise<string>` (camera GUID in, token string out).

## 3. IWebPlayer (API, DEV)

Methods:

| Method | Signature / notes |
|---|---|
| start | `(camera: string, mediaGatewayEndpoint: string, tokenRetriever, serverVersion?: string, throttlePtzCommands?: boolean) => Promise<void>`. Opens connection only; does not play. Rejects on bad params, network, or token problems |
| startWithService | `(camera, mediaGatewayService, serverVersion?, throttlePtzCommands?) => Promise<void>` (multiplexed) |
| playLive / seek(Date) / pause / resume | live mode; playback at UTC time |
| setPlaySpeed | `(n)`: 0.01..100 or -100..-0.01 (reverse is keyframe-only except MJPEG; min -6x recommended; >6x keyframe-only) |
| setAudioEnabled(bool), setPtzMode(bool) | audio (AAC only); low-latency PTZ mode (may trigger transcoding) |
| togglePrivacy(), showDebugOverlay(bool) | overlay shortcut Ctrl+Shift+A with canvas focus |
| getSnapshot | `() => ImageData \| null` (includes watermark) |
| getPlayerStats | `() => Promise<IPlayerStats>` |
| stop() / dispose() | stop clears the stream (black) and allows another `start()`; dispose releases resources, empties container, instance unusable. For `startWithService` players the shared connection stays open |

Read-only properties: `isStarted, ptzControl, digitalZoomControl (nullable), dewarperControl (nullable), timelineProvider, isLive, isPaused, playSpeed, lastFrameTime, isAudioAvailable, isAudioEnabled, isPrivacyProtected`.

Events (`ILiteEvent<T>`: `.register(handler)` / `.unregister(handler)`). Keep handlers light.

| Event | Payload |
|---|---|
| onErrorStateRaised | `{ errorCode: ErrorCode, value: string, isFatal: boolean }` |
| onStreamStatusChanged | `{ state: StreamingConnectionStatus, value: string }` |
| onPlayerStateChanged | `{ playerState: PlayerState, value: string }` |
| onFrameRendered | `Date` (periodic; do NOT use for FPS and do NOT treat absence as disconnect) |
| onPlaySpeedChanged | `{ playSpeed }` |
| onAudioStateChanged / onAudioAvailabilityChanged | `{ isAudioEnabled }` / `{ isAudioAvailable }` |
| onPlayerModeChanged | `{ playerMode: "unknown"\|"live"\|"playback" }` |
| onBufferingProgress | `number` 0-100 |
| onPrivacyProtectionChanged | `void` |

Lifecycle (DEV): `buildPlayer` (black, no connection; register handlers now) -> `await start()` -> `playLive()`/`seek()` -> `stop()` (reusable, preferred for performance) -> `dispose()` (unregister handlers first). Register all handlers BEFORE `start()` (APP).

Enums:

- PlayerState: Stopped 0, Buffering 1, Playing 2, Starting 3, Paused 4, Stopping 5, Rewinding 6, BeginReached 7, EndReached 8, WaitingForArchiverData 9, NoVideoSequenceAvailable 10, AwaitingSynchronizedTime 11 (reserved), Error 12, InsufficientSecurityInformation 13.
- StreamingConnectionStatus (INCOMPLETE in wiki; "see TypeScript definitions"): ConnectingToMediaGateway -1, Streaming 5, NotEnoughBandwidth 19, MediaRouterStreamNotFound 22, StreamUnreachable 25, UnauthorizedToken 31. Other values must be taken from gwp.d.ts.
- PlayerMode: "unknown" | "live" | "playback". TimelineEventKind: RecordingSequence 0, Bookmark 1. PtzFocusDistance: Near 0, Far 1. PtzIrisOperation: Open 0, Close 1.

## 4. Token flow (DEV, TRB, SMP)

- Endpoint: `GET {endpoint}/v2/token/{cameraId}`; header `Authorization: Basic base64(username;sdkCertificate:password)`; response body is the raw token string (text, not JSON). The browser sample uses `credentials: 'include'`.
- GWP calls the retriever at startup and "when renewal is required"; the callback must stay available for the whole session; several players may call it concurrently; it must return a valid token for the requested camera with the same user identity.
- Token lifetime / expiry / renewal interval: NOT DOCUMENTED. The wiki gives no expiry field; our `expiresAt` is a backend-contract extra, not a gateway concept. Samples have no caching or refresh logic.
- Never put credentials in the browser. Samples proxy via server `/api/token/{cameraId}`.
- Required SC privileges: application privilege "Web App"; camera "View live video" and/or "View playback"; valid SDK certificate; Media SDK license. Optional: Audio (talk/listen), Remove privacy protection. PTZ: basic operations, presets, patterns, lock, focus/iris (each separate, need View live video first). Partition access to the camera is also required.
- Token 401 bodies: BadCredentials, InsufficientPrivileges, MissingSdkCertificate, InvalidSdkCertificate, MissingMediaSdkLicense. Stream status 31 UnauthorizedToken is non-recoverable.

## 5. Multiplexing (DEV, MUX)

```js
const svc = await gwp.buildMediaGatewayService(`${endpoint}`, getTokenFct); // endpoint includes /media
const p = gwp.buildPlayer(el);
await p.startWithService(cameraGuid, svc);
p.playLive();
```

- One shared WebSocket for all players; `IMediaGatewayService` has no public methods. Stop/dispose of a player does not close the shared connection.
- Recommended by docs for 4+ cameras, video walls, dashboards. Individual connections for 1-3 cameras, different gateways, or failure isolation.
- Limits: single point of failure (WebSocket drop affects all); all cameras must be on the same Media Gateway. Maximum cameras per multiplexed service: NOT DOCUMENTED.
- Multicast: GWP docs never mention multicast. GWP delivers over WSS (unicast TCP) from the Media Gateway. Multicast exists only in the Media Gateway RTSP feature for third-party clients (MGW: the gateway assigns multicast addresses sequentially from a configured start endpoint; clients read `destination=`/`port=` from SETUP). Multicast between camera/Archiver and Media Router is a Security Center internal topic, not a browser concern.

## 6. Stats and diagnostics (API, DEV, TRB)

`getPlayerStats(): Promise<IPlayerStats>`. Fields:

`id, version, mode, state, speed, streamStatus (string|null), lastErrorCode, lastErrorMessage, videoCodec, resolution (IResolution|null), clockRate, fps, kfInterval (TimeSpan), videoBitrateKbps, audioBitrateKbps, isPrivacyProtected, playerStartTimestamp, packetsReceived, packetsLost, framesDecoded, framesDropped, networkLatency (TimeSpan), playerLatency (TimeSpan, decode+render), firstDataReceivedDelay (TimeSpan), firstDataReceivedTimestamp, firstFrameRenderDelay (TimeSpan), firstFrameRenderTimestamp, lastFrameReceived, lastFrameRendered, mediaTime, zoomLevel`.

- Numeric fields are `number|null` (null until known). `TimeSpan` and `IResolution` shapes are NOT DOCUMENTED (resolution likely width/height; TimeSpan representation must be checked in gwp.d.ts or at runtime).
- Not in stats: total bandwidth (derive by summing `videoBitrateKbps`+`audioBitrateKbps`, or measure at network layer), reconnection counts (count transitions on `onStreamStatusChanged`: -1 ConnectingToMediaGateway then 5 Streaming; docs use -1 as "connection lost, reconnecting"), error counts (`onErrorStateRaised`).
- Debug overlay (`showDebugOverlay(true)`): connection status, stream stats, frame rate, codec, buffering. `gwp.enableLogs(true)` for console.
- Polling frequency/cost of getPlayerStats: NOT DOCUMENTED.

## 7. PTZ, zoom, quality, audio, playback (DEV, API)

- PtzControl: `startPanTilt(pan,tilt)`/`stopPanTilt`/`startZoom`/`stopZoom` (-100..100), `goToPreset(n)`, `goHome`, `runPattern`, `stop`, `lock/unlock`, `startFocus(distance,speed)/stopFocus`, `startIris(op,speed)/stopIris`, `goToImagePosition(x,y,zoom)`. `setPtzMode(true)` = low latency, may transcode; turn off to reduce server load. `throttlePtzCommands` flag on start.
- Digital zoom (1-20x): `goTo, zoom, move, zoomWithFocus, stop, snapshot`, props `X, Y, Zoom, Preview{Enabled,Canvas}`, event `onPositionChanged`. Dewarper (fisheye, in-browser, CPU heavy; replaces digital zoom): `gotoPanTilt, gotoXY, gotoZoom, stopDewarping, snapshot`.
- Stream selection is automatic by player size: <640x480 Low Resolution; <1280x720 Live; >=1280x720 High Resolution (default thresholds, admin-configurable, re-evaluated on resize). Usage types: Live, Recording, Remote, Low, High. There is no client API to force a stream. Directly relevant to mosaic tiles: small tiles pull the low-res stream.
- Audio: AAC only; enable only after a user gesture (autoplay policy).
- Playback/timeline: `seek`, speeds, `timelineProvider.setTimelineRange(start,end)` (max 72 h, recommended 24 h; register `onTimelineContentUpdated` first; events kind 0 sequence / 1 bookmark; near-live gap of a few seconds). Timestamps UTC.

## 8. Codecs and transcoding (DEV, MGW)

- GWP limitations: browser natively handles H.264 and MJPEG; other codecs "may require transcoding". H.265 in GWP is NOT explicitly documented. Error 14 UnsupportedEncoding, 24 NoTranscodingAllowed, 32 ForbiddenTransformation apply.
- Transcoding setting on Media Gateway: Never / For PTZ only / Always (admin config). If H.265 cameras are used with "Never", expect failures; with "Always", server CPU load matters for 32 streams.
- RTSP side (MGW, not GWP): H.264, H.265, MJPEG, AV1 (v5.13.3.0+), no transcoding.
- Reverse playback smooth only for MJPEG.

## 9. Encryption, CORS, TLS (DEV, TRB, SMP)

- Encrypted streams: error 18 MissingCertificate (cannot decrypt), 21 CantUsePrivateKey, PlayerState 13 InsufficientSecurityInformation.
- CORS: Media Gateway handles `/v2/token`, `/v2/files`, `/v2/ws` by default. Strict mode in `C:\Program Files (x86)\Genetec Security Center X.X\ConfigurationFiles\MediaGateway.gconfig`: `<MediaGateway EnforceStrictCrossOrigin="true"><AllowedOrigin Origin="https://app:port"/></MediaGateway>` (origin = scheme+host+port); `EnforceStrictCrossOrigin="false"` dev only. Restart the Media Gateway role after edits. A Vite dev origin such as `http://localhost:5173` must be listed.
- TLS: browser must trust the gateway certificate (script and WSS fail otherwise: `NET::ERR_CERT_AUTHORITY_INVALID`). Self-signed only for dev (install in OS store). Browser to gateway must be reachable over HTTPS/WSS (port 443 default or configured). CSP needs `script-src` and `connect-src` (https + wss) for the gateway. Minimum TLS version NOT DOCUMENTED. WebSocket/proxy/VPN guidance NOT DOCUMENTED beyond "firewalls must allow WebSocket upgrade".
- Network matrix: browser->app server, browser->Media Gateway (gwp.js + WSS), browser->app backend (token), backend->Media Gateway (token fetch).

## 10. Error codes (API, DEV)

| Code | Name | Meaning / action |
|---|---|---|
| 0 | Unknown | retry |
| 2 | ConnectionLost | reconnect |
| 3 | InsufficientDiskSpace | server disk |
| 4 | ConnectionFailed | check network, retry |
| 6 | StreamNotFound | verify GUID, camera online |
| 9 | RequestTimedOut | retry |
| 11 | UnitPlaybackUnavailable | unit cannot play back |
| 12 | LiveCapacityExceeded | live limit reached (gateway/server) |
| 13 | PlaybackCapacityExceeded | playback limit reached |
| 14 | UnsupportedEncoding | codec unsupported, check camera/transcoding |
| 15 | DatabaseUpgradeRequired | Media Router DB upgrade |
| 16 | InsufficientPrivilege | privileges |
| 17 | InsufficientCapability | unit cannot process command |
| 18 | MissingCertificate | cannot decrypt |
| 20 | NotSupported | |
| 21 | CantUsePrivateKey | cert lacks private key |
| 22 | Mp4CodecNotSupported | reserved/unused |
| 23 | DeniedByServer | |
| 24 | NoTranscodingAllowed | transcoding blocked |
| 32 | ForbiddenTransformation | needs transcoding |
| 33 | CloudPlaybackFailure | |
| 34 | UnsupportedOmnicastFederationRole | |
| 1000 | UpdateSessionError | restart session |
| 10000 | DeviceOffline | |
| 10001 | ConnectionError | signaling error |
| 10002 | HlsPlaybackError | |
| 10003 | NoVideoRecording | |
| 10004 | OperationCanceled | |
| 10005 | TooManyClients | concurrent stream limit |
| 10006 | WebRtcStreamingDenied | tenant/gateway config |

Note: `errorCode` is a number (enum), not a string. `value` is non-localized text. `isFatal` tells whether the player stopped.

## 11. Reconnection and recovery (DEV)

- After an established connection drops, GWP reconnects automatically to the SAME endpoint, restoring live/playback state; it keeps retrying until stopped. Watch `onStreamStatusChanged`: -1 = reconnecting, 5 = streaming.
- Non-recoverable statuses (call `stop()`, report, no blind retry): 19 NotEnoughBandwidth, 22 MediaRouterStreamNotFound, 25 StreamUnreachable, 31 UnauthorizedToken.
- Gateway failover is app-driven: `stop()` then `start()` on a backup agent endpoint with its own token function, then `playLive()`. Do not auto-retry privilege/config errors; use exponential backoff otherwise; await any in-flight `start()` before retrying.
- Gateway-side load balancing: Role vs Agent; GWP connects to a specific agent endpoint (app picks, e.g. round robin). Per-agent session limits `MaximumLiveSessionCount` / `MaximumPlaybackSessionCount` in MediaGateway.gconfig (0 = unlimited; per agent, not per role) are documented in the RTSP guide and are the likely source of 503 / LiveCapacityExceeded; whether GWP sessions count against the same limits is not stated.

## 12. Limits and performance guidance

Documented: multiplex for 4+ players; reuse players via `stop()`/`start()`; keep event handlers light; turn off PTZ mode when idle; intense logging and dewarping are costly; small tiles get low-res streams automatically. NOT DOCUMENTED: max players per page/browser, per-browser decode limits, per-gateway stream capacity, bandwidth per stream, recommended hardware, token TTL.

## 13. Samples (SMP)

Three hosting samples (WPF + WebView2, ASP.NET Minimal API, Razor Pages with CSP nonces) using a server `/api/token/{cameraId}` proxy; config keys `MediaGateway.Endpoint, Username, Password, SdkCertificate, ServerVersion`. No expiry handling, no auth on the app itself. Minimal API sample README notes: server-side token fetch tolerates the dev certificate; browser still must trust it.

## 14. Open questions for SIES-M raised by the docs

1. Security Center and Media Gateway versions (determines gwp.js build; AV1 etc.).
2. Media Gateway URL, port and certificate (CA-signed? reachable from our VPN client network?), and CORS origins to whitelist.
3. SDK certificate, a dedicated test user with Web App + View live video, partitions covering the 32 cameras, Media SDK license.
4. Camera codecs (H.264 vs H.265), resolutions, bitrates per stream (low/live/high); transcoding setting (Never / PTZ only / Always).
5. `MaximumLiveSessionCount`, number of Media Gateway agents, expected server capacity for 32 concurrent live sessions.
6. What "multicast flows" means: camera-to-Archiver multicast inside SC (transparent to GWP) or a request for multicast delivery to the browser (not supported by GWP/WSS)?
7. Token TTL and whether the gateway enforces session expiry; any reverse proxy / WAF / VPN device that may break WebSocket upgrades.
8. Are any cameras encrypted (certificates) or privacy-protected?

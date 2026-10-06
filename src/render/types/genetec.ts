export type GenetecCameraStatus = "online" | "offline" | "unknown";

export interface GenetecCamera {
  id: string;
  /** Genetec camera GUID. */
  externalId: string;
  name: string;
  provider: "genetec";
  status: GenetecCameraStatus;
  lat: number | null;
  lng: number | null;
  ptz: boolean;
}

export interface GenetecTokenResponse {
  token: string;
  /** ISO date string. Backend contract extra: the gateway has no expiry concept. */
  expiresAt: string;
  mediaGatewayUrl: string;
}

export type PlayerStatus = "idle" | "loading" | "playing" | "error";

/**
 * GWP typings, hand-written from docs/genetec/gwp-reference.md.
 * TODO verify against gwp.d.ts (served at <MG>/media/v2/files/gwp.d.ts).
 */

/** Camera GUID in, token string out. */
export type GwpGetTokenFct = (cameraGuid: string) => Promise<string>;

/** Numeric error codes raised by onErrorStateRaised (documented values only). */
export enum GwpErrorCode {
  Unknown = 0,
  ConnectionLost = 2,
  InsufficientDiskSpace = 3,
  ConnectionFailed = 4,
  StreamNotFound = 6,
  RequestTimedOut = 9,
  UnitPlaybackUnavailable = 11,
  LiveCapacityExceeded = 12,
  PlaybackCapacityExceeded = 13,
  UnsupportedEncoding = 14,
  DatabaseUpgradeRequired = 15,
  InsufficientPrivilege = 16,
  InsufficientCapability = 17,
  MissingCertificate = 18,
  NotSupported = 20,
  CantUsePrivateKey = 21,
  Mp4CodecNotSupported = 22,
  DeniedByServer = 23,
  NoTranscodingAllowed = 24,
  ForbiddenTransformation = 32,
  CloudPlaybackFailure = 33,
  UnsupportedOmnicastFederationRole = 34,
  UpdateSessionError = 1000,
  DeviceOffline = 10000,
  ConnectionError = 10001,
  HlsPlaybackError = 10002,
  NoVideoRecording = 10003,
  OperationCanceled = 10004,
  TooManyClients = 10005,
  WebRtcStreamingDenied = 10006
}

/** Documented values only; the wiki table is incomplete. TODO verify against gwp.d.ts. */
export enum StreamingConnectionStatus {
  ConnectingToMediaGateway = -1,
  Streaming = 5,
  NotEnoughBandwidth = 19,
  MediaRouterStreamNotFound = 22,
  StreamUnreachable = 25,
  UnauthorizedToken = 31
}

export enum PlayerState {
  Stopped = 0,
  Buffering = 1,
  Playing = 2,
  Starting = 3,
  Paused = 4,
  Stopping = 5,
  Rewinding = 6,
  BeginReached = 7,
  EndReached = 8,
  WaitingForArchiverData = 9,
  NoVideoSequenceAvailable = 10,
  AwaitingSynchronizedTime = 11,
  Error = 12,
  InsufficientSecurityInformation = 13
}

export interface GwpErrorState {
  errorCode: GwpErrorCode | number;
  value: string;
  isFatal: boolean;
}

export interface GwpStreamStatus {
  state: StreamingConnectionStatus | number;
  value: string;
}

export interface GwpPlayerStateChange {
  playerState: PlayerState | number;
  value: string;
}

export interface GwpEvent<T> {
  register: (handler: (payload: T) => void) => void;
  unregister: (handler: (payload: T) => void) => void;
}

/** TimeSpan representation is NOT DOCUMENTED. TODO verify against gwp.d.ts. */
export type GwpTimeSpan = unknown;

export interface GwpResolution {
  width: number;
  height: number;
}

/** Numeric fields are null until known. TODO verify field types against gwp.d.ts. */
export interface IPlayerStats {
  id: string | null;
  version: string | null;
  mode: string | null;
  state: PlayerState | number | null;
  speed: number | null;
  streamStatus: string | null;
  lastErrorCode: number | null;
  lastErrorMessage: string | null;
  videoCodec: string | null;
  resolution: GwpResolution | null;
  clockRate: number | null;
  fps: number | null;
  kfInterval: GwpTimeSpan | null;
  videoBitrateKbps: number | null;
  audioBitrateKbps: number | null;
  isPrivacyProtected: boolean | null;
  playerStartTimestamp: number | string | null;
  packetsReceived: number | null;
  packetsLost: number | null;
  framesDecoded: number | null;
  framesDropped: number | null;
  networkLatency: GwpTimeSpan | null;
  /** Decode + render. */
  playerLatency: GwpTimeSpan | null;
  firstDataReceivedDelay: GwpTimeSpan | null;
  firstDataReceivedTimestamp: number | string | null;
  firstFrameRenderDelay: GwpTimeSpan | null;
  firstFrameRenderTimestamp: number | string | null;
  lastFrameReceived: number | string | null;
  lastFrameRendered: number | string | null;
  mediaTime: number | string | null;
  zoomLevel: number | null;
}

/** Shared WebSocket connection. No documented public methods. */
export interface IMediaGatewayService {
  // TODO verify against gwp.d.ts: no dispose is documented, called defensively if present.
  dispose?: () => void;
}

export interface GwpPlayer {
  start: (
    cameraGuid: string,
    mediaGatewayEndpoint: string,
    tokenRetriever: GwpGetTokenFct,
    serverVersion?: string,
    throttlePtzCommands?: boolean
  ) => Promise<void>;
  startWithService: (
    cameraGuid: string,
    mediaGatewayService: IMediaGatewayService,
    serverVersion?: string,
    throttlePtzCommands?: boolean
  ) => Promise<void>;
  playLive: () => void;
  stop: () => void;
  dispose: () => void;
  showDebugOverlay: (show: boolean) => void;
  /** Documented as Promise<IPlayerStats>. TODO verify against gwp.d.ts (task brief assumed sync). */
  getPlayerStats: () => Promise<IPlayerStats>;
  readonly isStarted: boolean;
  onErrorStateRaised: GwpEvent<GwpErrorState>;
  onStreamStatusChanged: GwpEvent<GwpStreamStatus>;
  onPlayerStateChanged: GwpEvent<GwpPlayerStateChange>;
  /** Periodic; never use for FPS or as a disconnect signal. */
  onFrameRendered: GwpEvent<Date>;
}

export interface GwpGlobal {
  buildPlayer: (container: HTMLElement) => GwpPlayer;
  buildMediaGatewayService: (
    endpoint: string,
    tokenRetriever: GwpGetTokenFct
  ) => Promise<IMediaGatewayService>;
  version: () => string;
  enableLogs: (intense?: boolean) => string;
  disableLogs?: () => string;
}

declare global {
  interface Window {
    gwp?: GwpGlobal;
  }
}

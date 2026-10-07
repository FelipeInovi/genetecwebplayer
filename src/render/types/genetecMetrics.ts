import type { ErrorSource } from "@/render/types/genetec";

export type CameraCount = 1 | 4 | 8 | 16 | 32;

export const CAMERA_COUNTS: readonly CameraCount[] = [1, 4, 8, 16, 32];

export interface TestPhase {
  id: string;
  cameraCount: number;
  multiplexed: boolean;
  /** Epoch ms. */
  startedAt: number;
  /** Epoch ms; null while the phase is running. */
  endedAt: number | null;
}

/** One poll of getPlayerStats() for one camera. Latencies in ms. */
export interface StatsSample {
  /** Epoch ms. */
  timestamp: number;
  phaseId: string;
  cameraId: string;
  networkLatency: number | null;
  playerLatency: number | null;
  firstFrameRenderDelay: number | null;
  firstDataReceivedDelay: number | null;
  fps: number | null;
  resolution: string | null;
  videoBitrateKbps: number | null;
  packetsLost: number | null;
  framesDropped: number | null;
  videoCodec: string | null;
}

interface StreamEventBase {
  /** Epoch ms. */
  timestamp: number;
  phaseId: string;
  cameraId: string;
  /** Error code (kind "error") or StreamingConnectionStatus value (kind "streamStatus"). */
  code: number;
  message: string;
  /** Monotonic arrival order: tie-break for events with the same timestamp. */
  seq?: number;
}

/** A failure (fatal or not). `source` says where it came from. */
export interface ErrorEvent extends StreamEventBase {
  kind: "error";
  isFatal: boolean;
  source: ErrorSource;
}

/** A GWP StreamingConnectionStatus change. */
export interface StreamStatusEvent extends StreamEventBase {
  kind: "streamStatus";
}

/** A cell began its start flow (baseline for time to first frame). */
export interface StartRequestedEvent extends StreamEventBase {
  kind: "start-requested";
}

export type StreamEvent = ErrorEvent | StreamStatusEvent | StartRequestedEvent;

export type StreamEventKind = StreamEvent["kind"];

/** Test-panel settings owned by the page (not by the stats store). */
export interface TestConfig {
  cameraCount: CameraCount;
  multiplexed: boolean;
  debugOverlay: boolean;
}

export const DEFAULT_TEST_CONFIG: TestConfig = {
  cameraCount: 4,
  multiplexed: false,
  debugOverlay: false
};

export interface Aggregate {
  avg: number | null;
  p95: number | null;
  max: number | null;
}

export interface PhaseSummary {
  phaseId: string;
  cameraCount: number;
  multiplexed: boolean;
  startedAt: number;
  endedAt: number | null;
  durationSec: number;
  sampleCount: number;
  activeCameras: number;
  networkLatencyMs: Aggregate;
  playerLatencyMs: Aggregate;
  avgFps: number | null;
  /** Sum of per-camera average video bitrate. */
  totalBandwidthKbps: number;
  /** Sum of per-camera positive deltas between samples (a decrease is a counter reset). */
  totalPacketsLost: number;
  totalFramesDropped: number;
  /** Per-camera first frame render delay, aggregated across cameras. */
  firstFrameRenderMs: { avg: number | null; max: number | null };
  errorCount: number;
  fatalErrorCount: number;
  reconnectionCount: number;
  /** Cells that started (or failed) in the phase but never reached Streaming. */
  camerasNeverStreamed: number;
  /** Cells that streamed at least once and ended the phase not streaming. */
  camerasEndedDisconnected: number;
  /** Per cell: first Streaming status minus the first start-requested event. */
  timeToFirstStreamingMs: { avg: number | null; max: number | null };
  /** getPlayerStats() reads that timed out or failed during the phase. */
  statsReadFailures: number;
}

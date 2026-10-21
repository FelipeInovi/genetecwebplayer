import { StreamingConnectionStatus } from "@/render/types/genetec";
import type { GwpResolution, IPlayerStats } from "@/render/types/genetec";
import type {
  Aggregate,
  ErrorEvent,
  PhaseSummary,
  StatsSample,
  StreamEvent,
  TestPhase
} from "@/render/types/genetecMetrics";

const isNum = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);

const TIMESPAN_RE = /^(?:(-?\d+)\.)?(\d+):(\d{2}):(\d{2})(?:\.(\d+))?$/;

/**
 * Normalizes a GWP TimeSpan to milliseconds. The representation is NOT
 * DOCUMENTED, so several plausible shapes are accepted.
 * TODO verify against gwp.d.ts (numbers are assumed to already be ms).
 */
export const timeSpanToMs = (value: unknown): number | null => {
  if (value === null || value === undefined) return null;
  if (isNum(value)) return value;
  if (typeof value === "string") {
    const m = TIMESPAN_RE.exec(value.trim());
    if (!m) return null;
    const [, days, h, min, s, frac] = m;
    const fracMs = frac ? Number(`0.${frac}`) * 1000 : 0;
    return (
      (Number(days ?? 0) * 86_400 + Number(h) * 3600 + Number(min) * 60 + Number(s)) *
        1000 +
      fracMs
    );
  }
  if (typeof value === "object") {
    const o = value as Record<string, unknown>;
    if (isNum(o.totalMilliseconds)) return o.totalMilliseconds;
    if (isNum(o.totalSeconds)) return o.totalSeconds * 1000;
    if (isNum(o.milliseconds)) return o.milliseconds;
  }
  return null;
};

export const resolutionToString = (
  resolution: GwpResolution | null | undefined
): string | null =>
  resolution && resolution.width > 0 && resolution.height > 0
    ? `${resolution.width}x${resolution.height}`
    : null;

const num = (v: unknown): number | null => (isNum(v) ? v : null);

export const buildSample = (
  phaseId: string,
  cameraId: string,
  timestamp: number,
  stats: IPlayerStats
): StatsSample => ({
  timestamp,
  phaseId,
  cameraId,
  networkLatency: timeSpanToMs(stats.networkLatency),
  playerLatency: timeSpanToMs(stats.playerLatency),
  firstFrameRenderDelay: timeSpanToMs(stats.firstFrameRenderDelay),
  firstDataReceivedDelay: timeSpanToMs(stats.firstDataReceivedDelay),
  fps: num(stats.fps),
  resolution: resolutionToString(stats.resolution),
  videoBitrateKbps: num(stats.videoBitrateKbps),
  packetsLost: num(stats.packetsLost),
  framesDropped: num(stats.framesDropped),
  videoCodec: stats.videoCodec ?? null
});

/** Nearest-rank percentile. */
export const percentile = (values: number[], p: number): number | null => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[rank - 1];
};

const average = (values: number[]): number | null =>
  values.length === 0
    ? null
    : values.reduce((a, b) => a + b, 0) / values.length;

// reduce, not Math.max(...values): spreading large arrays overflows the call stack.
const maxOf = (values: number[]): number | null =>
  values.length === 0 ? null : values.reduce((a, b) => (b > a ? b : a));

/**
 * Cumulative counter total: sum of positive deltas between consecutive samples.
 * The first reading counts from zero; a decrease is a counter reset (player
 * rebuilt), so the new value is added as-is. [5, 9, 0, 3] => 5 + 4 + 0 + 3 = 12.
 */
export const sumCounterDeltas = (values: number[]): number => {
  let total = 0;
  let prev = 0;
  for (const v of values) {
    total += v >= prev ? v - prev : v;
    prev = v;
  }
  return total;
};

const compareEvents = (a: StreamEvent, b: StreamEvent): number =>
  a.timestamp - b.timestamp || (a.seq ?? 0) - (b.seq ?? 0);

const aggregate = (values: number[]): Aggregate => ({
  avg: average(values),
  p95: percentile(values, 95),
  max: maxOf(values)
});

const present = (values: Array<number | null>): number[] =>
  values.filter((v): v is number => v !== null);

/**
 * Reconnection = per camera, a ConnectingToMediaGateway (-1) status AFTER the
 * camera has already streamed once, followed by Streaming (5). The initial
 * connect (-1 then 5) is not a reconnection. Consecutive -1s count once.
 */
export const countReconnections = (events: StreamEvent[]): number => {
  const state = new Map<string, { streamed: boolean; dropped: boolean }>();
  let count = 0;
  const ordered = events
    .filter((e) => e.kind === "streamStatus")
    .sort(compareEvents);
  for (const e of ordered) {
    const s = state.get(e.cameraId) ?? { streamed: false, dropped: false };
    if (e.code === StreamingConnectionStatus.ConnectingToMediaGateway) {
      if (s.streamed) s.dropped = true;
    } else if (e.code === StreamingConnectionStatus.Streaming) {
      if (s.dropped) count += 1;
      s.streamed = true;
      s.dropped = false;
    }
    state.set(e.cameraId, s);
  }
  return count;
};

interface StreamOutcomes {
  neverStreamed: number;
  endedDisconnected: number;
  timeToFirstStreamingMs: number[];
}

const streamOutcomes = (
  events: StreamEvent[],
  sampleCameras: Iterable<string>
): StreamOutcomes => {
  interface CameraTrack {
    startedAt: number | null;
    firstStreamingAt: number | null;
    lastStatus: number | null;
  }
  const tracks = new Map<string, CameraTrack>();
  const track = (id: string) => {
    let t = tracks.get(id);
    if (!t) {
      t = { startedAt: null, firstStreamingAt: null, lastStatus: null };
      tracks.set(id, t);
    }
    return t;
  };
  for (const id of sampleCameras) track(id);
  for (const e of [...events].sort(compareEvents)) {
    // Bookkeeping about the mosaic, not about a stream: it says nothing on whether it streamed.
    if (e.kind === "camera-assigned") continue;
    const t = track(e.cameraId);
    if (e.kind === "start-requested") {
      if (t.startedAt === null) t.startedAt = e.timestamp;
    } else if (e.kind === "streamStatus") {
      t.lastStatus = e.code;
      if (
        e.code === StreamingConnectionStatus.Streaming &&
        t.firstStreamingAt === null
      ) {
        t.firstStreamingAt = e.timestamp;
      }
    }
  }
  const out: StreamOutcomes = {
    neverStreamed: 0,
    endedDisconnected: 0,
    timeToFirstStreamingMs: []
  };
  tracks.forEach((t) => {
    if (t.firstStreamingAt === null) out.neverStreamed += 1;
    else if (t.lastStatus !== StreamingConnectionStatus.Streaming) {
      out.endedDisconnected += 1;
    }
    if (t.startedAt !== null && t.firstStreamingAt !== null) {
      out.timeToFirstStreamingMs.push(
        Math.max(0, t.firstStreamingAt - t.startedAt)
      );
    }
  });
  return out;
};

const groupByCamera = (samples: StatsSample[]) => {
  const groups = new Map<string, StatsSample[]>();
  for (const s of samples) {
    const list = groups.get(s.cameraId) ?? [];
    list.push(s);
    groups.set(s.cameraId, list);
  }
  return groups;
};

interface CameraSummary {
  bandwidthKbps: number;
  packetsLost: number;
  framesDropped: number;
  /** Latest reported first frame render delay. */
  firstFrameRenderMs: number | null;
}

const summarizeCamera = (list: StatsSample[]): CameraSummary => {
  const sorted = [...list].sort((a, b) => a.timestamp - b.timestamp);
  return {
    bandwidthKbps: average(present(sorted.map((s) => s.videoBitrateKbps))) ?? 0,
    // Counters are cumulative per player and may reset: sum positive deltas.
    packetsLost: sumCounterDeltas(present(sorted.map((s) => s.packetsLost))),
    framesDropped: sumCounterDeltas(present(sorted.map((s) => s.framesDropped))),
    firstFrameRenderMs:
      present(sorted.map((s) => s.firstFrameRenderDelay)).at(-1) ?? null
  };
};

export const isErrorEvent = (e: StreamEvent): e is ErrorEvent =>
  e.kind === "error";

export const countErrors = (
  events: StreamEvent[]
): { errorCount: number; fatalErrorCount: number } => {
  const errors = events.filter(isErrorEvent);
  return {
    errorCount: errors.length,
    fatalErrorCount: errors.filter((e) => e.isFatal).length
  };
};

export const summarizePhase = (
  phase: TestPhase,
  allSamples: StatsSample[],
  allEvents: StreamEvent[],
  now: number = Date.now(),
  statsReadFailures = 0
): PhaseSummary => {
  const samples = allSamples.filter((s) => s.phaseId === phase.id);
  const events = allEvents.filter((e) => e.phaseId === phase.id);
  const byCamera = groupByCamera(samples);

  const perCamera = [...byCamera.values()].map(summarizeCamera);
  const sumOf = (pick: (c: CameraSummary) => number) =>
    perCamera.reduce((total, c) => total + pick(c), 0);
  const firstFrames = present(perCamera.map((c) => c.firstFrameRenderMs));

  const { errorCount, fatalErrorCount } = countErrors(events);
  const end = phase.endedAt ?? now;
  const outcomes = streamOutcomes(events, byCamera.keys());

  return {
    phaseId: phase.id,
    cameraCount: phase.cameraCount,
    multiplexed: phase.multiplexed,
    startedAt: phase.startedAt,
    endedAt: phase.endedAt,
    durationSec: Math.max(0, Math.round((end - phase.startedAt) / 1000)),
    sampleCount: samples.length,
    activeCameras: byCamera.size,
    networkLatencyMs: aggregate(present(samples.map((s) => s.networkLatency))),
    playerLatencyMs: aggregate(present(samples.map((s) => s.playerLatency))),
    avgFps: average(present(samples.map((s) => s.fps))),
    totalBandwidthKbps: sumOf((c) => c.bandwidthKbps),
    totalPacketsLost: sumOf((c) => c.packetsLost),
    totalFramesDropped: sumOf((c) => c.framesDropped),
    firstFrameRenderMs: { avg: average(firstFrames), max: maxOf(firstFrames) },
    errorCount,
    fatalErrorCount,
    reconnectionCount: countReconnections(events),
    camerasNeverStreamed: outcomes.neverStreamed,
    camerasEndedDisconnected: outcomes.endedDisconnected,
    timeToFirstStreamingMs: {
      avg: average(outcomes.timeToFirstStreamingMs),
      max: maxOf(outcomes.timeToFirstStreamingMs)
    },
    statsReadFailures
  };
};

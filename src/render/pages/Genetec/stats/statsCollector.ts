import {
  buildSample,
  isErrorEvent,
  summarizePhase
} from "@/render/pages/Genetec/stats/metrics";
import {
  StreamingConnectionStatus,
  type GenetecTelemetryError,
  type IPlayerStats
} from "@/render/types/genetec";
import type {
  PhaseSummary,
  StatsSample,
  StreamEvent,
  TestPhase
} from "@/render/types/genetecMetrics";

// Plain module (no React, no zustand): the live-player registry, the polling
// loop and the raw sample/event arrays. The zustand store only mirrors the
// derived counters published through beginPhase().

const POLL_INTERVAL_MS = 1000;
/** A getter slower than this is a failed read: a hung player must not stall the tick. */
const STATS_READ_TIMEOUT_MS = 800;

type StatsGetter = () => Promise<IPlayerStats>;

export interface Counters {
  sampleCount: number;
  errorCount: number;
  reconnectionCount: number;
}

export const emptyCounters = (): Counters => ({
  sampleCount: 0,
  errorCount: 0,
  reconnectionCount: 0
});

// Live players are not React state: they register a getter while mounted.
const players = new Map<string, StatsGetter>();
let pollTimer: ReturnType<typeof setInterval> | null = null;
let polling = false;
let activePhaseId: string | null = null;
let publishCounters: ((counters: Counters) => void) | null = null;
let eventSeq = 0;

// Raw data: pushing is O(1) and does not re-render. The UI only sees the counters.
let samples: StatsSample[] = [];
let events: StreamEvent[] = [];
/** phaseId -> cameraId -> number of failed or timed-out getPlayerStats() reads. */
const readFailures = new Map<string, Map<string, number>>();

// Mutated as data arrives; published at most once per tick.
let pending: Counters = emptyCounters();
let countersDirty = false;
const reconnectTrack = new Map<string, { streamed: boolean; dropped: boolean }>();

/** Raw arrays, read on demand (CSV export, summaries). Not reactive. */
export const getSamples = (): StatsSample[] => samples;
export const getEvents = (): StreamEvent[] => events;

/** Registers a live player for polling. Returns the unregister function. */
export const registerPlayer = (
  cameraId: string,
  getStats: StatsGetter
): (() => void) => {
  players.set(cameraId, getStats);
  return () => {
    if (players.get(cameraId) === getStats) players.delete(cameraId);
  };
};

const stopPolling = () => {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
};

const readWithTimeout = async (getStats: StatsGetter): Promise<IPlayerStats> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error("getPlayerStats timed out")),
      STATS_READ_TIMEOUT_MS
    );
  });
  try {
    return await Promise.race([Promise.resolve().then(getStats), timeout]);
  } finally {
    clearTimeout(timer);
  }
};

const countReadFailure = (phaseId: string, cameraId: string) => {
  const byCamera = readFailures.get(phaseId) ?? new Map<string, number>();
  byCamera.set(cameraId, (byCamera.get(cameraId) ?? 0) + 1);
  readFailures.set(phaseId, byCamera);
};

const failuresFor = (phaseId: string): number => {
  let total = 0;
  readFailures.get(phaseId)?.forEach((n) => (total += n));
  return total;
};

const trackReconnection = (cameraId: string, code: number) => {
  const s = reconnectTrack.get(cameraId) ?? { streamed: false, dropped: false };
  if (code === StreamingConnectionStatus.ConnectingToMediaGateway) {
    if (s.streamed) s.dropped = true;
  } else if (code === StreamingConnectionStatus.Streaming) {
    if (s.dropped) pending.reconnectionCount += 1;
    s.streamed = true;
    s.dropped = false;
  }
  reconnectTrack.set(cameraId, s);
};

type DistributiveOmit<T, K extends keyof T> = T extends unknown
  ? Omit<T, K>
  : never;
type NewEvent = DistributiveOmit<StreamEvent, "timestamp" | "phaseId" | "seq">;

/** Single write path for events: nothing is recorded outside an active phase. */
const pushEvent = (event: NewEvent): void => {
  if (!activePhaseId) return;
  eventSeq += 1;
  const stored = {
    ...event,
    timestamp: Date.now(),
    phaseId: activePhaseId,
    seq: eventSeq
  } as StreamEvent;
  events.push(stored);
  if (isErrorEvent(stored)) pending.errorCount += 1;
  else if (stored.kind === "streamStatus") {
    trackReconnection(stored.cameraId, stored.code);
  }
  countersDirty = true;
};

export const recordStart = (cameraId: string): void =>
  pushEvent({ kind: "start-requested", cameraId, code: 0, message: "" });

export const recordCameraAssigned = (
  cellIndex: number,
  cameraId: string,
  previousCameraId: string | null
): void =>
  pushEvent({
    kind: "camera-assigned",
    cameraId,
    code: 0,
    message: "",
    cellIndex,
    previousCameraId
  });

export const recordStreamStatus = (
  cameraId: string,
  code: number,
  message: string
): void => pushEvent({ kind: "streamStatus", cameraId, code, message });

export const recordError = (
  cameraId: string,
  error: GenetecTelemetryError
): void => pushEvent({ kind: "error", cameraId, ...error });

/** One publish per call, and none when nothing changed. */
const flushCounters = () => {
  if (!countersDirty) return;
  countersDirty = false;
  publishCounters?.({ ...pending });
};

export const pollOnce = async (): Promise<void> => {
  const phaseId = activePhaseId;
  // A slow read must not stack: skip this tick while the previous one runs.
  if (!phaseId || polling) return;
  polling = true;
  try {
    const results = await Promise.all(
      [...players.entries()].map(async ([cameraId, getStats]) => {
        try {
          return buildSample(
            phaseId,
            cameraId,
            Date.now(),
            await readWithTimeout(getStats)
          );
        } catch {
          // Player mid start/stop, hung or failing: skip it, but count it.
          if (activePhaseId === phaseId) countReadFailure(phaseId, cameraId);
          return null;
        }
      })
    );
    if (activePhaseId !== phaseId) return;
    for (const r of results) {
      if (r) {
        samples.push(r);
        pending.sampleCount += 1;
        countersDirty = true;
      }
    }
    flushCounters();
  } finally {
    polling = false;
  }
};

/** Starts recording and polling for a phase. `publish` receives the counters once per tick. */
export const beginPhase = (
  phaseId: string,
  publish: (counters: Counters) => void
): void => {
  activePhaseId = phaseId;
  publishCounters = publish;
  pending = emptyCounters();
  countersDirty = false;
  reconnectTrack.clear();
  stopPolling();
  pollTimer = setInterval(() => {
    void pollOnce();
  }, POLL_INTERVAL_MS);
};

/** Stops recording and polling. Returns the counters accumulated since the last publish. */
export const endPhase = (): Counters => {
  stopPolling();
  activePhaseId = null;
  publishCounters = null;
  countersDirty = false;
  return { ...pending };
};

export const summarizePhases = (phases: TestPhase[]): PhaseSummary[] =>
  phases.map((p) =>
    summarizePhase(p, samples, events, Date.now(), failuresFor(p.id))
  );

/** Tests only: clears registry, raw data and timers. */
export const resetCollector = (): void => {
  stopPolling();
  players.clear();
  activePhaseId = null;
  publishCounters = null;
  polling = false;
  eventSeq = 0;
  samples = [];
  events = [];
  readFailures.clear();
  reconnectTrack.clear();
  pending = emptyCounters();
  countersDirty = false;
};

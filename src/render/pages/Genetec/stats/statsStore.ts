import { create } from "zustand";
import {
  buildSample,
  summarizePhase
} from "@/render/pages/Genetec/stats/metrics";
import { StreamingConnectionStatus } from "@/render/types/genetec";
import type { IPlayerStats } from "@/render/types/genetec";
import type {
  ErrorSource,
  PhaseSummary,
  StatsSample,
  StreamEvent,
  TestPhase
} from "@/render/types/genetecMetrics";

const POLL_INTERVAL_MS = 1000;
/** A getter slower than this is a failed read: a hung player must not stall the tick. */
const STATS_READ_TIMEOUT_MS = 800;
const DEFAULT_CAMERA_COUNT = 4;

type StatsGetter = () => Promise<IPlayerStats>;

// Live players are not React state: they register a getter while mounted.
const players = new Map<string, StatsGetter>();
let pollTimer: ReturnType<typeof setInterval> | null = null;
let phaseSeq = 0;
let eventSeq = 0;
let polling = false;

// Raw data lives outside React/zustand state: pushing to these arrays is O(1) and
// does not re-render. The UI only sees the derived counters below.
let samples: StatsSample[] = [];
let events: StreamEvent[] = [];
/** phaseId -> cameraId -> number of failed or timed-out getPlayerStats() reads. */
const readFailures = new Map<string, Map<string, number>>();

interface Counters {
  sampleCount: number;
  errorCount: number;
  reconnectionCount: number;
}
const emptyCounters = (): Counters => ({
  sampleCount: 0,
  errorCount: 0,
  reconnectionCount: 0
});
// Mutated as data arrives; copied into the store at most once per tick.
let pending: Counters = emptyCounters();
let countersDirty = false;
const reconnectTrack = new Map<string, { streamed: boolean; dropped: boolean }>();

// Cameras that reached Streaming (any phase): tells a token renewal from a first token.
const streamedCameras = new Set<string>();
export const hasCameraStreamed = (cameraId: string): boolean =>
  streamedCameras.has(cameraId);
export const forgetCamera = (cameraId: string) => {
  streamedCameras.delete(cameraId);
};

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

interface ErrorInput {
  code: number;
  isFatal: boolean;
  message: string;
  /** Stable origin of the failure (see ErrorSource). */
  source?: ErrorSource | string;
}

interface StatsState extends Counters {
  cameraCount: number;
  multiplexed: boolean;
  debugOverlay: boolean;
  /** Bumped on every phase start so the mosaic remounts and first-frame times are in-phase. */
  runKey: number;
  phases: TestPhase[];
  activePhaseId: string | null;
  setCameraCount: (count: number) => void;
  setMultiplexed: (multiplexed: boolean) => void;
  setDebugOverlay: (show: boolean) => void;
  startPhase: () => void;
  stopPhase: () => void;
  pollOnce: () => Promise<void>;
  recordStart: (cameraId: string) => void;
  recordStreamStatus: (cameraId: string, code: number, message: string) => void;
  recordError: (cameraId: string, error: ErrorInput) => void;
  getSummaries: () => PhaseSummary[];
}

const initialState = () => ({
  cameraCount: DEFAULT_CAMERA_COUNT,
  multiplexed: false,
  debugOverlay: false,
  runKey: 0,
  phases: [] as TestPhase[],
  activePhaseId: null as string | null,
  ...emptyCounters()
});

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
  countersDirty = true;
};

const pushEvent = (event: Omit<StreamEvent, "seq">) => {
  eventSeq += 1;
  events.push({ ...event, seq: eventSeq });
  countersDirty = true;
};

export const useStatsStore = create<StatsState>((set, get) => {
  /** One store update per call, and none when nothing changed. */
  const flushCounters = () => {
    if (!countersDirty) return;
    countersDirty = false;
    set({ ...pending });
  };

  return {
    ...initialState(),

    setCameraCount: (cameraCount) => set({ cameraCount }),
    setMultiplexed: (multiplexed) => set({ multiplexed }),
    setDebugOverlay: (debugOverlay) => set({ debugOverlay }),

    startPhase: () => {
      const s = get();
      if (s.activePhaseId) return;
      phaseSeq += 1;
      const phase: TestPhase = {
        id: `phase-${phaseSeq}`,
        cameraCount: s.cameraCount,
        multiplexed: s.multiplexed,
        startedAt: Date.now(),
        endedAt: null
      };
      pending = emptyCounters();
      countersDirty = false;
      reconnectTrack.clear();
      set({
        phases: [...s.phases, phase],
        activePhaseId: phase.id,
        runKey: s.runKey + 1,
        ...emptyCounters()
      });
      stopPolling();
      pollTimer = setInterval(() => {
        void get().pollOnce();
      }, POLL_INTERVAL_MS);
    },

    stopPhase: () => {
      stopPolling();
      const { activePhaseId, phases } = get();
      if (!activePhaseId) return;
      const endedAt = Date.now();
      countersDirty = false;
      set({
        activePhaseId: null,
        phases: phases.map((p) => (p.id === activePhaseId ? { ...p, endedAt } : p)),
        ...pending
      });
    },

    pollOnce: async () => {
      const phaseId = get().activePhaseId;
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
              if (get().activePhaseId === phaseId) countReadFailure(phaseId, cameraId);
              return null;
            }
          })
        );
        if (get().activePhaseId !== phaseId) return;
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
    },

    recordStart: (cameraId) => {
      const phaseId = get().activePhaseId;
      if (!phaseId) return;
      pushEvent({
        kind: "start-requested",
        timestamp: Date.now(),
        phaseId,
        cameraId,
        code: 0,
        isFatal: false,
        message: ""
      });
    },

    recordStreamStatus: (cameraId, code, message) => {
      if (code === StreamingConnectionStatus.Streaming) {
        streamedCameras.add(cameraId);
      }
      const phaseId = get().activePhaseId;
      if (!phaseId) return;
      trackReconnection(cameraId, code);
      pushEvent({
        kind: "streamStatus",
        timestamp: Date.now(),
        phaseId,
        cameraId,
        code,
        isFatal: false,
        message
      });
    },

    recordError: (cameraId, error) => {
      const phaseId = get().activePhaseId;
      if (!phaseId) return;
      pending.errorCount += 1;
      pushEvent({
        kind: "error",
        timestamp: Date.now(),
        phaseId,
        cameraId,
        code: error.code,
        isFatal: error.isFatal,
        message: error.message,
        source: error.source
      });
    },

    getSummaries: () =>
      get().phases.map((p) =>
        summarizePhase(p, samples, events, Date.now(), failuresFor(p.id))
      )
  };
});

/** Tests only: clears state, registry, raw data and timers. */
export const resetStatsStore = () => {
  stopPolling();
  players.clear();
  phaseSeq = 0;
  eventSeq = 0;
  polling = false;
  samples = [];
  events = [];
  readFailures.clear();
  reconnectTrack.clear();
  streamedCameras.clear();
  pending = emptyCounters();
  countersDirty = false;
  useStatsStore.setState(initialState());
};

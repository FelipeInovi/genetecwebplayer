import { create } from "zustand";
import {
  buildSample,
  summarizePhase
} from "@/render/pages/Genetec/stats/metrics";
import type { IPlayerStats } from "@/render/types/genetec";
import type {
  PhaseSummary,
  StatsSample,
  StreamEvent,
  TestPhase
} from "@/render/types/genetecMetrics";

const POLL_INTERVAL_MS = 1000;
const DEFAULT_CAMERA_COUNT = 4;

type StatsGetter = () => Promise<IPlayerStats>;

// Live players are not React state: they register a getter while mounted.
const players = new Map<string, StatsGetter>();
let pollTimer: ReturnType<typeof setInterval> | null = null;
let phaseSeq = 0;

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
}

interface StatsState {
  cameraCount: number;
  multiplexed: boolean;
  debugOverlay: boolean;
  /** Bumped on every phase start so the mosaic remounts and first-frame times are in-phase. */
  runKey: number;
  phases: TestPhase[];
  activePhaseId: string | null;
  samples: StatsSample[];
  events: StreamEvent[];
  setCameraCount: (count: number) => void;
  setMultiplexed: (multiplexed: boolean) => void;
  setDebugOverlay: (show: boolean) => void;
  startPhase: () => void;
  stopPhase: () => void;
  pollOnce: () => Promise<void>;
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
  samples: [] as StatsSample[],
  events: [] as StreamEvent[]
});

const stopPolling = () => {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
};

export const useStatsStore = create<StatsState>((set, get) => ({
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
    set({
      phases: [...s.phases, phase],
      activePhaseId: phase.id,
      runKey: s.runKey + 1
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
    set({
      activePhaseId: null,
      phases: phases.map((p) => (p.id === activePhaseId ? { ...p, endedAt } : p))
    });
  },

  pollOnce: async () => {
    const phaseId = get().activePhaseId;
    if (!phaseId) return;
    const entries = [...players.entries()];
    const results = await Promise.all(
      entries.map(async ([cameraId, getStats]) => {
        try {
          return buildSample(phaseId, cameraId, Date.now(), await getStats());
        } catch {
          return null; // Player may be mid start/stop: skip this tick.
        }
      })
    );
    const fresh = results.filter((r): r is StatsSample => r !== null);
    if (fresh.length === 0 || get().activePhaseId !== phaseId) return;
    set((s) => ({ samples: [...s.samples, ...fresh] }));
  },

  recordStreamStatus: (cameraId, code, message) => {
    const phaseId = get().activePhaseId;
    if (!phaseId) return;
    const event: StreamEvent = {
      kind: "streamStatus",
      timestamp: Date.now(),
      phaseId,
      cameraId,
      code,
      isFatal: false,
      message
    };
    set((s) => ({ events: [...s.events, event] }));
  },

  recordError: (cameraId, error) => {
    const phaseId = get().activePhaseId;
    if (!phaseId) return;
    const event: StreamEvent = {
      kind: "error",
      timestamp: Date.now(),
      phaseId,
      cameraId,
      code: error.code,
      isFatal: error.isFatal,
      message: error.message
    };
    set((s) => ({ events: [...s.events, event] }));
  },

  getSummaries: () => {
    const { phases, samples, events } = get();
    return phases.map((p) => summarizePhase(p, samples, events));
  }
}));

/** Tests only: clears state, registry and timers. */
export const resetStatsStore = () => {
  stopPolling();
  players.clear();
  phaseSeq = 0;
  useStatsStore.setState(initialState());
};

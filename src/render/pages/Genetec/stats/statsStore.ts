import { create } from "zustand";
import {
  beginPhase,
  emptyCounters,
  endPhase,
  pollOnce,
  resetCollector,
  summarizePhases,
  type Counters
} from "@/render/pages/Genetec/stats/statsCollector";
import type {
  PhaseSummary,
  TestConfig,
  TestPhase
} from "@/render/types/genetecMetrics";

// UI-facing state only: phase lifecycle and derived counters. Players, polling
// and the raw arrays live in statsCollector.

export type PhaseConfig = Pick<TestConfig, "cameraCount" | "multiplexed">;

interface StatsState extends Counters {
  /** Bumped on every phase start so the mosaic remounts and first-frame times are in-phase. */
  runKey: number;
  phases: TestPhase[];
  activePhaseId: string | null;
  startPhase: (config: PhaseConfig) => void;
  stopPhase: () => void;
  pollOnce: () => Promise<void>;
  getSummaries: () => PhaseSummary[];
}

let phaseSeq = 0;

const initialState = () => ({
  runKey: 0,
  phases: [] as TestPhase[],
  activePhaseId: null as string | null,
  ...emptyCounters()
});

export const useStatsStore = create<StatsState>((set, get) => ({
  ...initialState(),

  startPhase: ({ cameraCount, multiplexed }) => {
    const s = get();
    if (s.activePhaseId) return;
    phaseSeq += 1;
    const phase: TestPhase = {
      id: `phase-${phaseSeq}`,
      cameraCount,
      multiplexed,
      startedAt: Date.now(),
      endedAt: null
    };
    set({
      phases: [...s.phases, phase],
      activePhaseId: phase.id,
      runKey: s.runKey + 1,
      ...emptyCounters()
    });
    beginPhase(phase.id, (counters) => set(counters));
  },

  stopPhase: () => {
    const { activePhaseId, phases } = get();
    const counters = endPhase();
    if (!activePhaseId) return;
    const endedAt = Date.now();
    set({
      activePhaseId: null,
      phases: phases.map((p) => (p.id === activePhaseId ? { ...p, endedAt } : p)),
      ...counters
    });
  },

  pollOnce,

  getSummaries: () => summarizePhases(get().phases)
}));

/** Tests only: clears the store and the collector. */
export const resetStatsStore = () => {
  resetCollector();
  phaseSeq = 0;
  useStatsStore.setState(initialState());
};

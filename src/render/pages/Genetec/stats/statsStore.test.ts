import {
  getSamples,
  recordError,
  recordStreamStatus,
  registerPlayer
} from "@/render/pages/Genetec/stats/statsCollector";
import {
  resetStatsStore,
  useStatsStore,
  type PhaseConfig
} from "@/render/pages/Genetec/stats/statsStore";
import type { IPlayerStats } from "@/render/types/genetec";

const fakeStats = (fps: number) =>
  ({
    fps,
    networkLatency: 10,
    playerLatency: 5,
    videoBitrateKbps: 800,
    packetsLost: 0,
    framesDropped: 0,
    resolution: { width: 640, height: 360 },
    videoCodec: "H264"
  }) as unknown as IPlayerStats;

const state = () => useStatsStore.getState();
const PHASE_CONFIG: PhaseConfig = { cameraCount: 4, multiplexed: false };
const nonFatal = { code: 1, isFatal: false, message: "", source: "gwp-error" } as const;

describe("statsStore", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    resetStatsStore();
  });
  afterEach(() => {
    state().stopPhase();
    jest.useRealTimers();
  });

  it("starts a phase with the given camera count and mode", () => {
    const runKey = state().runKey;
    state().startPhase({ cameraCount: 8, multiplexed: true });
    const phase = state().phases[0];
    expect(phase).toMatchObject({
      cameraCount: 8,
      multiplexed: true,
      endedAt: null
    });
    expect(state().activePhaseId).toBe(phase.id);
    expect(state().runKey).toBe(runKey + 1);
  });

  it("does not start a second phase while one is active", () => {
    state().startPhase(PHASE_CONFIG);
    state().startPhase(PHASE_CONFIG);
    expect(state().phases).toHaveLength(1);
  });

  it("stops the active phase and records endedAt", () => {
    state().startPhase(PHASE_CONFIG);
    jest.advanceTimersByTime(5000);
    state().stopPhase();
    expect(state().activePhaseId).toBeNull();
    expect(state().phases[0].endedAt).toBe(Date.now());
  });

  it("polls registered players once per second until the phase stops", async () => {
    registerPlayer("cam-a", jest.fn().mockResolvedValue(fakeStats(25)));
    state().startPhase(PHASE_CONFIG);
    await jest.advanceTimersByTimeAsync(3000);
    expect(getSamples()).toHaveLength(3);
    state().stopPhase();
    await jest.advanceTimersByTimeAsync(5000);
    expect(getSamples()).toHaveLength(3);
  });

  it("pollOnce takes one sample per registered player", async () => {
    registerPlayer("cam-a", jest.fn().mockResolvedValue(fakeStats(25)));
    registerPlayer("cam-b", jest.fn().mockResolvedValue(fakeStats(30)));
    state().startPhase(PHASE_CONFIG);
    await state().pollOnce();
    expect(getSamples()).toHaveLength(2);
    expect(state().sampleCount).toBe(2);
  });

  it("builds summaries for all phases", () => {
    state().startPhase(PHASE_CONFIG);
    recordError("c", nonFatal);
    state().stopPhase();
    const summaries = state().getSummaries();
    expect(summaries).toHaveLength(1);
    expect(summaries[0].errorCount).toBe(1);
  });

  it("keeps raw samples and events out of the reactive state (C3)", async () => {
    registerPlayer("cam-a", jest.fn().mockResolvedValue(fakeStats(25)));
    state().startPhase(PHASE_CONFIG);
    await jest.advanceTimersByTimeAsync(1000);
    expect(state()).not.toHaveProperty("samples");
    expect(state()).not.toHaveProperty("events");
    expect(state().sampleCount).toBe(1);
  });

  it("holds no UI configuration (camera count, mode, overlay)", () => {
    expect(state()).not.toHaveProperty("cameraCount");
    expect(state()).not.toHaveProperty("multiplexed");
    expect(state()).not.toHaveProperty("debugOverlay");
  });

  it("updates derived counters at most once per tick (C3)", async () => {
    registerPlayer("cam-a", jest.fn().mockResolvedValue(fakeStats(25)));
    state().startPhase(PHASE_CONFIG);
    recordError("cam-a", nonFatal);
    recordError("cam-a", { ...nonFatal, code: 2 });
    expect(state().errorCount).toBe(0);
    let updates = 0;
    const off = useStatsStore.subscribe(() => (updates += 1));
    await jest.advanceTimersByTimeAsync(1000);
    off();
    expect(state().errorCount).toBe(2);
    expect(state().sampleCount).toBe(1);
    expect(updates).toBe(1);
  });

  it("counts reconnections incrementally (C3)", async () => {
    state().startPhase(PHASE_CONFIG);
    recordStreamStatus("c", 5, "");
    recordStreamStatus("c", -1, "");
    recordStreamStatus("c", 5, "");
    await jest.advanceTimersByTimeAsync(1000);
    expect(state().reconnectionCount).toBe(1);
  });
});

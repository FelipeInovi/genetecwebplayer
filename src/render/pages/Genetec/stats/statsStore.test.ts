import {
  registerPlayer,
  resetStatsStore,
  useStatsStore
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

  it("starts a phase with the selected camera count and mode", () => {
    state().setCameraCount(8);
    state().setMultiplexed(true);
    const runKey = state().runKey;
    state().startPhase();
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
    state().startPhase();
    state().startPhase();
    expect(state().phases).toHaveLength(1);
  });

  it("stops the active phase and records endedAt", () => {
    state().startPhase();
    jest.advanceTimersByTime(5000);
    state().stopPhase();
    expect(state().activePhaseId).toBeNull();
    expect(state().phases[0].endedAt).toBe(Date.now());
  });

  it("polls every registered player once per second while a phase runs", async () => {
    const a = jest.fn().mockResolvedValue(fakeStats(25));
    const b = jest.fn().mockResolvedValue(fakeStats(30));
    const offA = registerPlayer("cam-a", a);
    registerPlayer("cam-b", b);
    state().startPhase();
    await jest.advanceTimersByTimeAsync(1000);
    expect(state().samples).toHaveLength(2);
    await jest.advanceTimersByTimeAsync(2000);
    expect(state().samples).toHaveLength(6);
    expect(state().samples[0]).toMatchObject({
      phaseId: state().phases[0].id,
      resolution: "640x360",
      networkLatency: 10
    });
    offA();
    await jest.advanceTimersByTimeAsync(1000);
    expect(state().samples).toHaveLength(7);
  });

  it("stops polling when the phase stops", async () => {
    const a = jest.fn().mockResolvedValue(fakeStats(25));
    registerPlayer("cam-a", a);
    state().startPhase();
    await jest.advanceTimersByTimeAsync(1000);
    state().stopPhase();
    await jest.advanceTimersByTimeAsync(5000);
    expect(state().samples).toHaveLength(1);
  });

  it("survives a player whose stats call fails", async () => {
    registerPlayer("bad", jest.fn().mockRejectedValue(new Error("x")));
    registerPlayer("ok", jest.fn().mockResolvedValue(fakeStats(25)));
    state().startPhase();
    await jest.advanceTimersByTimeAsync(1000);
    expect(state().samples.map((s) => s.cameraId)).toEqual(["ok"]);
  });

  it("only logs events while a phase is active", () => {
    state().recordStreamStatus("cam-a", 5, "Streaming");
    expect(state().events).toHaveLength(0);
    state().startPhase();
    state().recordStreamStatus("cam-a", 5, "Streaming");
    state().recordError("cam-a", { code: 4, isFatal: true, message: "boom" });
    expect(state().events).toHaveLength(2);
    expect(state().events[1]).toMatchObject({
      kind: "error",
      code: 4,
      isFatal: true,
      cameraId: "cam-a"
    });
  });

  it("builds summaries for all phases", () => {
    state().startPhase();
    state().recordError("c", { code: 1, isFatal: false, message: "" });
    state().stopPhase();
    const summaries = state().getSummaries();
    expect(summaries).toHaveLength(1);
    expect(summaries[0].errorCount).toBe(1);
  });
});

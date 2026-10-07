import {
  getEvents,
  getSamples,
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
    expect(getSamples()).toHaveLength(2);
    await jest.advanceTimersByTimeAsync(2000);
    expect(getSamples()).toHaveLength(6);
    expect(getSamples()[0]).toMatchObject({
      phaseId: state().phases[0].id,
      resolution: "640x360",
      networkLatency: 10
    });
    offA();
    await jest.advanceTimersByTimeAsync(1000);
    expect(getSamples()).toHaveLength(7);
  });

  it("stops polling when the phase stops", async () => {
    const a = jest.fn().mockResolvedValue(fakeStats(25));
    registerPlayer("cam-a", a);
    state().startPhase();
    await jest.advanceTimersByTimeAsync(1000);
    state().stopPhase();
    await jest.advanceTimersByTimeAsync(5000);
    expect(getSamples()).toHaveLength(1);
  });

  it("survives a player whose stats call fails", async () => {
    registerPlayer("bad", jest.fn().mockRejectedValue(new Error("x")));
    registerPlayer("ok", jest.fn().mockResolvedValue(fakeStats(25)));
    state().startPhase();
    await jest.advanceTimersByTimeAsync(1000);
    expect(getSamples().map((s) => s.cameraId)).toEqual(["ok"]);
  });

  it("only logs events while a phase is active", () => {
    state().recordStreamStatus("cam-a", 5, "Streaming");
    expect(getEvents()).toHaveLength(0);
    state().startPhase();
    state().recordStreamStatus("cam-a", 5, "Streaming");
    state().recordError("cam-a", { code: 4, isFatal: true, message: "boom" });
    expect(getEvents()).toHaveLength(2);
    expect(getEvents()[1]).toMatchObject({
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

  it("keeps raw samples and events out of the reactive state (C3)", async () => {
    registerPlayer("cam-a", jest.fn().mockResolvedValue(fakeStats(25)));
    state().startPhase();
    await jest.advanceTimersByTimeAsync(1000);
    expect(state()).not.toHaveProperty("samples");
    expect(state()).not.toHaveProperty("events");
    expect(state().sampleCount).toBe(1);
  });

  it("appends to the same raw arrays instead of copying them (C3)", async () => {
    registerPlayer("cam-a", jest.fn().mockResolvedValue(fakeStats(25)));
    state().startPhase();
    const samplesRef = getSamples();
    const eventsRef = getEvents();
    await jest.advanceTimersByTimeAsync(2000);
    state().recordError("cam-a", { code: 1, isFatal: false, message: "" });
    expect(getSamples()).toBe(samplesRef);
    expect(getEvents()).toBe(eventsRef);
    expect(samplesRef).toHaveLength(2);
  });

  it("updates derived counters at most once per tick (C3)", async () => {
    registerPlayer("cam-a", jest.fn().mockResolvedValue(fakeStats(25)));
    state().startPhase();
    state().recordError("cam-a", { code: 1, isFatal: false, message: "" });
    state().recordError("cam-a", { code: 2, isFatal: false, message: "" });
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
    state().startPhase();
    state().recordStreamStatus("c", 5, "");
    state().recordStreamStatus("c", -1, "");
    state().recordStreamStatus("c", 5, "");
    await jest.advanceTimersByTimeAsync(1000);
    expect(state().reconnectionCount).toBe(1);
  });

  it("records a start-requested event with a monotonic seq (B1)", () => {
    state().startPhase();
    state().recordStart("cam-a");
    state().recordStart("cam-b");
    const [a, b] = getEvents();
    expect(a).toMatchObject({ kind: "start-requested", cameraId: "cam-a" });
    expect(b.seq).toBeGreaterThan(a.seq as number);
  });

  it("keeps the error source on recorded errors (B1)", () => {
    state().startPhase();
    state().recordError("cam-a", {
      code: 0,
      isFatal: true,
      message: "x",
      source: "token"
    });
    expect(getEvents()[0]).toMatchObject({ kind: "error", source: "token" });
  });

  it("skips a tick while the previous poll is still running (C2)", async () => {
    let release!: (s: IPlayerStats) => void;
    const slow = jest
      .fn()
      .mockImplementationOnce(
        () => new Promise<IPlayerStats>((r) => (release = r))
      )
      .mockResolvedValue(fakeStats(25));
    registerPlayer("cam-a", slow);
    state().startPhase();
    const first = state().pollOnce();
    await jest.advanceTimersByTimeAsync(0);
    await state().pollOnce();
    expect(slow).toHaveBeenCalledTimes(1);
    release(fakeStats(25));
    await first;
    await state().pollOnce();
    expect(slow).toHaveBeenCalledTimes(2);
  });

  it("times out a hung getter and counts it as a read failure (C2)", async () => {
    registerPlayer("hung", () => new Promise<IPlayerStats>(() => undefined));
    registerPlayer("ok", jest.fn().mockResolvedValue(fakeStats(25)));
    state().startPhase();
    await jest.advanceTimersByTimeAsync(1000 + 800);
    expect(getSamples().map((s) => s.cameraId)).toEqual(["ok"]);
    state().stopPhase();
    expect(state().getSummaries()[0].statsReadFailures).toBe(1);
  });

  it("counts rejected getters per phase (C2)", async () => {
    registerPlayer("bad", jest.fn().mockRejectedValue(new Error("x")));
    state().startPhase();
    await jest.advanceTimersByTimeAsync(2000);
    state().stopPhase();
    expect(state().getSummaries()[0].statsReadFailures).toBe(2);
  });
});

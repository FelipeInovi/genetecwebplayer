import {
  beginPhase,
  endPhase,
  getEvents,
  getSamples,
  pollOnce,
  recordError,
  recordStart,
  recordStreamStatus,
  registerPlayer,
  resetCollector,
  summarizePhases
} from "@/render/pages/Genetec/stats/statsCollector";
import type { IPlayerStats } from "@/render/types/genetec";
import type { TestPhase } from "@/render/types/genetecMetrics";

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

const PHASE = "phase-1";
const publish = jest.fn();
const begin = () => beginPhase(PHASE, publish);
const nonFatal = { code: 1, isFatal: false, message: "", source: "gwp-error" } as const;

describe("statsCollector", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    resetCollector();
    publish.mockClear();
  });
  afterEach(() => {
    endPhase();
    jest.useRealTimers();
  });

  it("polls every registered player once per second while a phase runs", async () => {
    const a = jest.fn().mockResolvedValue(fakeStats(25));
    const b = jest.fn().mockResolvedValue(fakeStats(30));
    const offA = registerPlayer("cam-a", a);
    registerPlayer("cam-b", b);
    begin();
    await jest.advanceTimersByTimeAsync(1000);
    expect(getSamples()).toHaveLength(2);
    await jest.advanceTimersByTimeAsync(2000);
    expect(getSamples()).toHaveLength(6);
    expect(getSamples()[0]).toMatchObject({
      phaseId: PHASE,
      resolution: "640x360",
      networkLatency: 10
    });
    offA();
    await jest.advanceTimersByTimeAsync(1000);
    expect(getSamples()).toHaveLength(7);
  });

  it("unregister only removes the getter it registered", async () => {
    const first = jest.fn().mockResolvedValue(fakeStats(25));
    const second = jest.fn().mockResolvedValue(fakeStats(30));
    const offFirst = registerPlayer("cam-a", first);
    registerPlayer("cam-a", second);
    offFirst();
    begin();
    await jest.advanceTimersByTimeAsync(1000);
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
  });

  it("stops polling when the phase ends", async () => {
    registerPlayer("cam-a", jest.fn().mockResolvedValue(fakeStats(25)));
    begin();
    await jest.advanceTimersByTimeAsync(1000);
    endPhase();
    await jest.advanceTimersByTimeAsync(5000);
    expect(getSamples()).toHaveLength(1);
  });

  it("survives a player whose stats call fails", async () => {
    registerPlayer("bad", jest.fn().mockRejectedValue(new Error("x")));
    registerPlayer("ok", jest.fn().mockResolvedValue(fakeStats(25)));
    begin();
    await jest.advanceTimersByTimeAsync(1000);
    expect(getSamples().map((s) => s.cameraId)).toEqual(["ok"]);
  });

  it("only logs events while a phase is active", () => {
    recordStreamStatus("cam-a", 5, "Streaming");
    expect(getEvents()).toHaveLength(0);
    begin();
    recordStreamStatus("cam-a", 5, "Streaming");
    recordError("cam-a", {
      code: 4,
      isFatal: true,
      message: "boom",
      source: "start"
    });
    expect(getEvents()).toHaveLength(2);
    expect(getEvents()[1]).toMatchObject({
      kind: "error",
      code: 4,
      isFatal: true,
      cameraId: "cam-a"
    });
  });

  it("carries isFatal and source on error events only", () => {
    begin();
    recordStreamStatus("cam-a", 5, "Streaming");
    recordStart("cam-a");
    const [status, start] = getEvents();
    expect(status).not.toHaveProperty("isFatal");
    expect(status).not.toHaveProperty("source");
    expect(start).not.toHaveProperty("isFatal");
  });

  it("keeps the error source on recorded errors (B1)", () => {
    begin();
    recordError("cam-a", {
      code: 0,
      isFatal: true,
      message: "x",
      source: "token"
    });
    expect(getEvents()[0]).toMatchObject({ kind: "error", source: "token" });
  });

  it("records a start-requested event with a monotonic seq (B1)", () => {
    begin();
    recordStart("cam-a");
    recordStart("cam-b");
    const [a, b] = getEvents();
    expect(a).toMatchObject({ kind: "start-requested", cameraId: "cam-a" });
    expect(b.seq).toBeGreaterThan(a.seq as number);
  });

  it("appends to the same raw arrays instead of copying them (C3)", async () => {
    registerPlayer("cam-a", jest.fn().mockResolvedValue(fakeStats(25)));
    begin();
    const samplesRef = getSamples();
    const eventsRef = getEvents();
    await jest.advanceTimersByTimeAsync(2000);
    recordError("cam-a", nonFatal);
    expect(getSamples()).toBe(samplesRef);
    expect(getEvents()).toBe(eventsRef);
    expect(samplesRef).toHaveLength(2);
  });

  it("publishes derived counters at most once per tick (C3)", async () => {
    registerPlayer("cam-a", jest.fn().mockResolvedValue(fakeStats(25)));
    begin();
    recordError("cam-a", nonFatal);
    recordError("cam-a", { ...nonFatal, code: 2 });
    expect(publish).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1000);
    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledWith({
      sampleCount: 1,
      errorCount: 2,
      reconnectionCount: 0
    });
  });

  it("does not publish when nothing changed during a tick", async () => {
    begin();
    await jest.advanceTimersByTimeAsync(3000);
    expect(publish).not.toHaveBeenCalled();
  });

  it("returns the pending counters when the phase ends", () => {
    begin();
    recordError("cam-a", nonFatal);
    expect(endPhase()).toEqual({
      sampleCount: 0,
      errorCount: 1,
      reconnectionCount: 0
    });
  });

  it("counts reconnections incrementally (C3)", async () => {
    begin();
    recordStreamStatus("c", 5, "");
    recordStreamStatus("c", -1, "");
    recordStreamStatus("c", 5, "");
    await jest.advanceTimersByTimeAsync(1000);
    expect(publish).toHaveBeenLastCalledWith(
      expect.objectContaining({ reconnectionCount: 1 })
    );
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
    begin();
    const first = pollOnce();
    await jest.advanceTimersByTimeAsync(0);
    await pollOnce();
    expect(slow).toHaveBeenCalledTimes(1);
    release(fakeStats(25));
    await first;
    await pollOnce();
    expect(slow).toHaveBeenCalledTimes(2);
  });

  describe("summarizePhases", () => {
    const phase = (): TestPhase => ({
      id: PHASE,
      cameraCount: 4,
      multiplexed: false,
      startedAt: Date.now(),
      endedAt: null
    });

    it("times out a hung getter and counts it as a read failure (C2)", async () => {
      registerPlayer("hung", () => new Promise<IPlayerStats>(() => undefined));
      registerPlayer("ok", jest.fn().mockResolvedValue(fakeStats(25)));
      begin();
      await jest.advanceTimersByTimeAsync(1000 + 800);
      expect(getSamples().map((s) => s.cameraId)).toEqual(["ok"]);
      endPhase();
      expect(summarizePhases([phase()])[0].statsReadFailures).toBe(1);
    });

    it("counts rejected getters per phase (C2)", async () => {
      registerPlayer("bad", jest.fn().mockRejectedValue(new Error("x")));
      begin();
      await jest.advanceTimersByTimeAsync(2000);
      endPhase();
      expect(summarizePhases([phase()])[0].statsReadFailures).toBe(2);
    });

    it("summarizes error counts from the recorded events", () => {
      begin();
      recordError("c", nonFatal);
      endPhase();
      expect(summarizePhases([phase()])[0].errorCount).toBe(1);
    });
  });
});

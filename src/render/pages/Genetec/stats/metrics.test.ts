import {
  buildSample,
  countErrors,
  countReconnections,
  isErrorEvent,
  percentile,
  resolutionToString,
  summarizePhase,
  timeSpanToMs
} from "@/render/pages/Genetec/stats/metrics";
import type {
  StatsSample,
  StreamEvent,
  TestPhase
} from "@/render/types/genetecMetrics";
import type { IPlayerStats } from "@/render/types/genetec";

describe("timeSpanToMs", () => {
  it("handles null and undefined", () => {
    expect(timeSpanToMs(null)).toBeNull();
    expect(timeSpanToMs(undefined)).toBeNull();
  });
  it("treats numbers as milliseconds", () => {
    expect(timeSpanToMs(42)).toBe(42);
  });
  it("parses .NET style strings", () => {
    expect(timeSpanToMs("00:00:01.500")).toBe(1500);
    expect(timeSpanToMs("00:01:00")).toBe(60_000);
    expect(timeSpanToMs("1.00:00:00")).toBe(86_400_000);
  });
  it("reads object shapes", () => {
    expect(timeSpanToMs({ totalMilliseconds: 12.5 })).toBe(12.5);
    expect(timeSpanToMs({ milliseconds: 7 })).toBe(7);
    expect(timeSpanToMs({ totalSeconds: 2 })).toBe(2000);
  });
  it("returns null for unknown shapes", () => {
    expect(timeSpanToMs({ foo: 1 })).toBeNull();
    expect(timeSpanToMs("abc")).toBeNull();
    expect(timeSpanToMs(Number.NaN)).toBeNull();
  });
});

describe("resolutionToString", () => {
  it("formats width x height", () => {
    expect(resolutionToString({ width: 1920, height: 1080 })).toBe("1920x1080");
  });
  it("returns null when unknown", () => {
    expect(resolutionToString(null)).toBeNull();
    expect(resolutionToString({ width: 0, height: 0 })).toBeNull();
  });
});

describe("percentile", () => {
  it("computes nearest-rank percentiles", () => {
    const values = Array.from({ length: 20 }, (_, i) => i + 1);
    expect(percentile(values, 95)).toBe(19);
    expect(percentile([5], 95)).toBe(5);
    expect(percentile([], 95)).toBeNull();
  });
});

describe("buildSample", () => {
  it("normalizes player stats into a flat sample", () => {
    const stats = {
      networkLatency: "00:00:00.040",
      playerLatency: 12,
      firstFrameRenderDelay: { totalMilliseconds: 800 },
      firstDataReceivedDelay: 300,
      fps: 25,
      resolution: { width: 640, height: 360 },
      videoBitrateKbps: 900,
      packetsLost: 3,
      framesDropped: 1,
      videoCodec: "H264"
    } as unknown as IPlayerStats;
    expect(buildSample("p1", "cam-1", 1000, stats)).toEqual({
      timestamp: 1000,
      phaseId: "p1",
      cameraId: "cam-1",
      networkLatency: 40,
      playerLatency: 12,
      firstFrameRenderDelay: 800,
      firstDataReceivedDelay: 300,
      fps: 25,
      resolution: "640x360",
      videoBitrateKbps: 900,
      packetsLost: 3,
      framesDropped: 1,
      videoCodec: "H264"
    });
  });
});

const ev = (
  cameraId: string,
  code: number,
  timestamp: number,
  kind: StreamEvent["kind"] = "streamStatus",
  isFatal = false
): StreamEvent => {
  const base = { timestamp, phaseId: "p1", cameraId, code, message: "" };
  return kind === "error"
    ? { ...base, kind, isFatal, source: "gwp-error" }
    : { ...base, kind };
};

describe("countErrors", () => {
  it("counts error events and the fatal subset, ignoring other kinds", () => {
    const events = [
      ev("a", 4, 1, "error", true),
      ev("a", 9, 2, "error", false),
      ev("a", 5, 3),
      ev("a", 0, 4, "start-requested")
    ];
    expect(countErrors(events)).toEqual({ errorCount: 2, fatalErrorCount: 1 });
    expect(events.filter(isErrorEvent)).toHaveLength(2);
  });
});

describe("countReconnections", () => {
  it("does not count the initial connect", () => {
    expect(countReconnections([ev("a", -1, 1), ev("a", 5, 2)])).toBe(0);
  });
  it("counts a drop followed by Streaming", () => {
    expect(
      countReconnections([
        ev("a", -1, 1),
        ev("a", 5, 2),
        ev("a", -1, 3),
        ev("a", 5, 4)
      ])
    ).toBe(1);
  });
  it("counts repeated drops once each and keeps cameras independent", () => {
    expect(
      countReconnections([
        ev("a", 5, 1),
        ev("b", 5, 1),
        ev("a", -1, 2),
        ev("a", -1, 3),
        ev("a", 5, 4),
        ev("b", -1, 5),
        ev("a", -1, 6),
        ev("b", 5, 7),
        ev("a", 5, 8)
      ])
    ).toBe(3);
  });
  it("keeps arrival order for events with the same timestamp (seq tie-break)", () => {
    const withSeq = (e: StreamEvent, seq: number): StreamEvent => ({ ...e, seq });
    const events = [
      withSeq(ev("a", 5, 1), 0),
      // Handed over out of arrival order on purpose: same ms, seq decides.
      withSeq(ev("a", 5, 5), 3),
      withSeq(ev("a", -1, 5), 2)
    ];
    expect(countReconnections(events)).toBe(1);
  });
  it("ignores a drop that never recovers and error events", () => {
    expect(
      countReconnections([
        ev("a", 5, 1),
        ev("a", -1, 2),
        ev("a", 4, 3, "error")
      ])
    ).toBe(0);
  });
});

const phase: TestPhase = {
  id: "p1",
  cameraCount: 2,
  multiplexed: true,
  startedAt: 0,
  endedAt: 10_000
};
const sample = (
  cameraId: string,
  timestamp: number,
  over: Partial<StatsSample> = {}
): StatsSample => ({
  timestamp,
  phaseId: "p1",
  cameraId,
  networkLatency: null,
  playerLatency: null,
  firstFrameRenderDelay: null,
  firstDataReceivedDelay: null,
  fps: null,
  resolution: null,
  videoBitrateKbps: null,
  packetsLost: null,
  framesDropped: null,
  videoCodec: null,
  ...over
});

describe("summarizePhase", () => {
  it("aggregates latency, fps, bandwidth, counters, first frame and events", () => {
    const samples = [
      sample("a", 1000, {
        networkLatency: 10,
        playerLatency: 4,
        fps: 20,
        videoBitrateKbps: 1000,
        packetsLost: 1,
        framesDropped: 0,
        firstFrameRenderDelay: 500
      }),
      sample("a", 2000, {
        networkLatency: 30,
        playerLatency: 6,
        fps: 30,
        videoBitrateKbps: 2000,
        packetsLost: 4,
        framesDropped: 2,
        firstFrameRenderDelay: 500
      }),
      sample("b", 1000, {
        networkLatency: 20,
        playerLatency: 5,
        fps: 25,
        videoBitrateKbps: 500,
        packetsLost: 2,
        framesDropped: 1,
        firstFrameRenderDelay: 900
      }),
      sample("x", 99_999, { phaseId: "other", fps: 1000 })
    ];
    const events = [
      ev("a", 5, 1),
      ev("a", -1, 2),
      ev("a", 5, 3),
      ev("a", 4, 4, "error", false),
      ev("b", 12, 5, "error", true)
    ];
    const s = summarizePhase(phase, samples, events);

    expect(s.phaseId).toBe("p1");
    expect(s.durationSec).toBe(10);
    expect(s.sampleCount).toBe(3);
    expect(s.activeCameras).toBe(2);
    expect(s.networkLatencyMs).toEqual({ avg: 20, p95: 30, max: 30 });
    expect(s.playerLatencyMs.max).toBe(6);
    expect(s.avgFps).toBe(25);
    // a avg 1500 + b avg 500
    expect(s.totalBandwidthKbps).toBe(2000);
    expect(s.totalPacketsLost).toBe(4 + 2);
    expect(s.totalFramesDropped).toBe(2 + 1);
    expect(s.firstFrameRenderMs).toEqual({ avg: 700, max: 900 });
    expect(s.errorCount).toBe(2);
    expect(s.fatalErrorCount).toBe(1);
    expect(s.reconnectionCount).toBe(1);
  });

  it("returns nulls and zeros for an empty phase", () => {
    const s = summarizePhase({ ...phase, endedAt: null }, [], []);
    expect(s.sampleCount).toBe(0);
    expect(s.avgFps).toBeNull();
    expect(s.networkLatencyMs.avg).toBeNull();
    expect(s.totalBandwidthKbps).toBe(0);
    expect(s.errorCount).toBe(0);
  });
});

describe("summarizePhase (counters and robustness)", () => {
  const counterSamples = (cameraId: string, values: Array<number | null>) =>
    values.map((v, i) =>
      sample(cameraId, (i + 1) * 1000, { packetsLost: v, framesDropped: v })
    );

  it("sums positive deltas and treats a decrease as a counter reset ([5,9,0,3] => 12)", () => {
    const s = summarizePhase(phase, counterSamples("a", [5, 9, 0, 3]), []);
    expect(s.totalPacketsLost).toBe(12);
    expect(s.totalFramesDropped).toBe(12);
  });

  it("sums the totals across cameras and ignores missing readings", () => {
    const s = summarizePhase(
      phase,
      [...counterSamples("a", [1, null, 4]), ...counterSamples("b", [2, 2])],
      []
    );
    expect(s.totalPacketsLost).toBe(4 + 2);
  });

  it("handles 200k samples without spreading into Math.max", () => {
    const many = Array.from({ length: 200_000 }, (_, i) =>
      sample("a", i, { networkLatency: i % 50, packetsLost: i })
    );
    const s = summarizePhase(phase, many, []);
    expect(s.networkLatencyMs.max).toBe(49);
    expect(s.totalPacketsLost).toBe(199_999);
  });

  it("reports cameras that never reached Streaming and unrecovered drops", () => {
    const events = [
      ev("a", 5, 10),
      ev("b", -1, 11),
      ev("c", 5, 12),
      ev("c", -1, 20),
      ev("d", 5, 12),
      ev("d", -1, 20),
      ev("d", 5, 30),
      ev("e", 0, 15, "error", true)
    ];
    const s = summarizePhase(phase, [], events);
    expect(s.camerasNeverStreamed).toBe(2); // b and e
    expect(s.camerasEndedDisconnected).toBe(1); // c
  });

  it("derives time to first Streaming from the start-requested baseline", () => {
    const events = [
      ev("a", 0, 100, "start-requested"),
      ev("a", 5, 600),
      ev("b", 0, 100, "start-requested"),
      ev("b", 5, 1100),
      ev("c", 0, 100, "start-requested")
    ];
    const s = summarizePhase(phase, [], events);
    expect(s.timeToFirstStreamingMs).toEqual({ avg: 750, max: 1000 });
    expect(s.camerasNeverStreamed).toBe(1);
    expect(s.errorCount).toBe(0);
  });

  it("carries the stats read failure count", () => {
    expect(summarizePhase(phase, [], [], 0, 7).statsReadFailures).toBe(7);
  });
});

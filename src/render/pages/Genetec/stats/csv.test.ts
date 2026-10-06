import {
  buildSamplesCsv,
  buildSummaryCsv,
  escapeCsvField,
  toCsv
} from "@/render/pages/Genetec/stats/csv";
import type {
  PhaseSummary,
  StatsSample
} from "@/render/types/genetecMetrics";

describe("escapeCsvField", () => {
  it("renders null/undefined as empty", () => {
    expect(escapeCsvField(null)).toBe("");
    expect(escapeCsvField(undefined)).toBe("");
  });
  it("quotes fields with commas, quotes or newlines", () => {
    expect(escapeCsvField("a,b")).toBe('"a,b"');
    expect(escapeCsvField('say "hi"')).toBe('"say ""hi"""');
    expect(escapeCsvField("a\nb")).toBe('"a\nb"');
  });
  it("stringifies numbers and booleans", () => {
    expect(escapeCsvField(1.5)).toBe("1.5");
    expect(escapeCsvField(true)).toBe("true");
  });
});

describe("toCsv", () => {
  it("joins header and rows with CRLF", () => {
    expect(toCsv(["a", "b"], [[1, "x"], [2, null]])).toBe(
      "a,b\r\n1,x\r\n2,\r\n"
    );
  });
});

describe("buildSamplesCsv", () => {
  it("emits the documented columns and ISO timestamps", () => {
    const sample: StatsSample = {
      timestamp: Date.UTC(2026, 0, 1, 0, 0, 0),
      phaseId: "p1",
      cameraId: "cam-1",
      networkLatency: 10,
      playerLatency: 5,
      firstFrameRenderDelay: 800,
      firstDataReceivedDelay: 300,
      fps: 25,
      resolution: "640x360",
      videoBitrateKbps: 900,
      packetsLost: 0,
      framesDropped: 1,
      videoCodec: "H264"
    };
    const [header, row] = buildSamplesCsv([sample]).split("\r\n");
    expect(header).toBe(
      "timestamp,phaseId,cameraId,networkLatencyMs,playerLatencyMs,firstFrameRenderDelayMs,firstDataReceivedDelayMs,fps,resolution,videoBitrateKbps,packetsLost,framesDropped,videoCodec"
    );
    expect(row).toBe(
      "2026-01-01T00:00:00.000Z,p1,cam-1,10,5,800,300,25,640x360,900,0,1,H264"
    );
  });
});

describe("buildSummaryCsv", () => {
  it("emits one row per phase", () => {
    const summary: PhaseSummary = {
      phaseId: "p1",
      cameraCount: 4,
      multiplexed: true,
      startedAt: Date.UTC(2026, 0, 1),
      endedAt: null,
      durationSec: 12,
      sampleCount: 40,
      activeCameras: 4,
      networkLatencyMs: { avg: 10, p95: 20, max: 30 },
      playerLatencyMs: { avg: 1, p95: 2, max: 3 },
      avgFps: 24.5,
      totalBandwidthKbps: 4000,
      totalPacketsLost: 2,
      totalFramesDropped: 3,
      firstFrameRenderMs: { avg: 700, max: 900 },
      errorCount: 1,
      fatalErrorCount: 0,
      reconnectionCount: 2,
      camerasNeverStreamed: 1,
      camerasEndedDisconnected: 2,
      timeToFirstStreamingMs: { avg: 1500, max: 2500 },
      statsReadFailures: 3
    };
    const lines = buildSummaryCsv([summary]).trimEnd().split("\r\n");
    expect(lines).toHaveLength(2);
    expect(lines[0].split(",")).toContain("totalBandwidthKbps");
    expect(lines[0].split(",")).toContain("reconnectionCount");
    expect(lines[1]).toContain("p1,4,true,2026-01-01T00:00:00.000Z,,12");
    const header = lines[0].split(",");
    const row = lines[1].split(",");
    const col = (name: string) => row[header.indexOf(name)];
    expect(col("camerasNeverStreamed")).toBe("1");
    expect(col("camerasEndedDisconnected")).toBe("2");
    expect(col("timeToFirstStreamingAvgMs")).toBe("1500");
    expect(col("timeToFirstStreamingMaxMs")).toBe("2500");
    expect(col("statsReadFailures")).toBe("3");
  });
});

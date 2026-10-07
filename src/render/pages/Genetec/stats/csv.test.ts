import {
  buildEventsCsv,
  buildSamplesCsv,
  buildSummaryCsv,
  escapeCsvField,
  toCsv
} from "@/render/pages/Genetec/stats/csv";
import type {
  PhaseSummary,
  StreamEvent,
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

describe("buildEventsCsv", () => {
  const event = (over: Partial<StreamEvent> = {}): StreamEvent => ({
    kind: "error",
    timestamp: Date.UTC(2026, 0, 2, 3, 4, 5),
    seq: 7,
    phaseId: "phase-1",
    cameraId: "cam-1",
    code: 12,
    isFatal: true,
    message: "free text is never exported",
    source: "token",
    ...over
  });
  const lines = (csv: string) => csv.trimEnd().split("\r\n");

  it("writes one row per event with the documented header", () => {
    const out = lines(buildEventsCsv([event()]));
    expect(out[0]).toBe("ts,seq,phaseId,cameraId,kind,source,code,isFatal,status");
    expect(out[1]).toBe("2026-01-02T03:04:05.000Z,7,phase-1,cam-1,error,token,12,true,");
  });

  it("puts the stream status in the status column and leaves code empty", () => {
    const row = lines(
      buildEventsCsv([event({ kind: "streamStatus", code: 5, isFatal: false, source: undefined })])
    )[1];
    expect(row).toBe("2026-01-02T03:04:05.000Z,7,phase-1,cam-1,streamStatus,,,false,5");
  });

  it("escapes commas, quotes and newlines", () => {
    const row = lines(buildEventsCsv([event({ cameraId: 'a,"b"' })]))[1];
    expect(row).toContain('"a,""b"""');
  });

  it.each(["=SUM(1)", "+1", "-1", "@cmd"])(
    "neutralizes formula injection in %s with a single quote",
    (value) => {
      const csv = buildEventsCsv([event({ cameraId: value, source: value })]);
      expect(csv).not.toContain(`,${value}`);
      expect(csv).toContain(`'${value}`);
    }
  );
});

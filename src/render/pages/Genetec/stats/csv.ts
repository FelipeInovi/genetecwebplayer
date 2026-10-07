import type {
  PhaseSummary,
  StatsSample,
  StreamEvent
} from "@/render/types/genetecMetrics";

type Cell = string | number | boolean | null | undefined;

export const escapeCsvField = (value: Cell): string => {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

export const toCsv = (header: string[], rows: Cell[][]): string =>
  [header, ...rows]
    .map((row) => row.map(escapeCsvField).join(","))
    .join("\r\n") + "\r\n";

const iso = (ms: number | null): string | null =>
  ms === null ? null : new Date(ms).toISOString();

const SAMPLE_HEADER = [
  "timestamp",
  "phaseId",
  "cameraId",
  "networkLatencyMs",
  "playerLatencyMs",
  "firstFrameRenderDelayMs",
  "firstDataReceivedDelayMs",
  "fps",
  "resolution",
  "videoBitrateKbps",
  "packetsLost",
  "framesDropped",
  "videoCodec"
];

export const buildSamplesCsv = (samples: StatsSample[]): string =>
  toCsv(
    SAMPLE_HEADER,
    samples.map((s) => [
      iso(s.timestamp),
      s.phaseId,
      s.cameraId,
      s.networkLatency,
      s.playerLatency,
      s.firstFrameRenderDelay,
      s.firstDataReceivedDelay,
      s.fps,
      s.resolution,
      s.videoBitrateKbps,
      s.packetsLost,
      s.framesDropped,
      s.videoCodec
    ])
  );

const SUMMARY_HEADER = [
  "phaseId",
  "cameraCount",
  "multiplexed",
  "startedAt",
  "endedAt",
  "durationSec",
  "sampleCount",
  "activeCameras",
  "networkLatencyAvgMs",
  "networkLatencyP95Ms",
  "networkLatencyMaxMs",
  "playerLatencyAvgMs",
  "playerLatencyP95Ms",
  "playerLatencyMaxMs",
  "avgFps",
  "totalBandwidthKbps",
  "totalPacketsLost",
  "totalFramesDropped",
  "firstFrameRenderAvgMs",
  "firstFrameRenderMaxMs",
  "errorCount",
  "fatalErrorCount",
  "reconnectionCount",
  "camerasNeverStreamed",
  "camerasEndedDisconnected",
  "timeToFirstStreamingAvgMs",
  "timeToFirstStreamingMaxMs",
  "statsReadFailures"
];

export const buildSummaryCsv = (summaries: PhaseSummary[]): string =>
  toCsv(
    SUMMARY_HEADER,
    summaries.map((s) => [
      s.phaseId,
      s.cameraCount,
      s.multiplexed,
      iso(s.startedAt),
      iso(s.endedAt),
      s.durationSec,
      s.sampleCount,
      s.activeCameras,
      s.networkLatencyMs.avg,
      s.networkLatencyMs.p95,
      s.networkLatencyMs.max,
      s.playerLatencyMs.avg,
      s.playerLatencyMs.p95,
      s.playerLatencyMs.max,
      s.avgFps,
      s.totalBandwidthKbps,
      s.totalPacketsLost,
      s.totalFramesDropped,
      s.firstFrameRenderMs.avg,
      s.firstFrameRenderMs.max,
      s.errorCount,
      s.fatalErrorCount,
      s.reconnectionCount,
      s.camerasNeverStreamed,
      s.camerasEndedDisconnected,
      s.timeToFirstStreamingMs.avg,
      s.timeToFirstStreamingMs.max,
      s.statsReadFailures
    ])
  );

const EVENT_HEADER = [
  "ts",
  "seq",
  "phaseId",
  "cameraId",
  "kind",
  "source",
  "code",
  "isFatal",
  "status"
];

/**
 * Spreadsheets run cells starting with = + - @ as formulas: prefix a single quote.
 * Only strings are touched (numbers such as -1 stay numeric).
 */
const neutralizeFormula = (value: string | undefined): string | undefined =>
  value !== undefined && /^[=+\-@]/.test(value) ? `'${value}` : value;

/**
 * One row per recorded event. Free-text messages are NOT exported.
 * "status" is the StreamingConnectionStatus of "streamStatus" events;
 * "code" is the error code of the other kinds.
 */
export const buildEventsCsv = (events: StreamEvent[]): string =>
  toCsv(
    EVENT_HEADER,
    events.map((e) => {
      const isStatus = e.kind === "streamStatus";
      const isError = e.kind === "error";
      return [
        iso(e.timestamp),
        e.seq,
        neutralizeFormula(e.phaseId),
        neutralizeFormula(e.cameraId),
        neutralizeFormula(e.kind),
        neutralizeFormula(isError ? e.source : undefined),
        isStatus ? null : e.code,
        isError && e.isFatal,
        isStatus ? e.code : null
      ];
    })
  );

/** Browser-only: triggers a file download through a temporary object URL. */
export const downloadCsv = (filename: string, content: string) => {
  const url = URL.createObjectURL(new Blob([content], { type: "text/csv" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
};

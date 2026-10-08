import {
  beginPhase,
  endPhase,
  getEvents,
  getSamples,
  pollOnce,
  resetCollector
} from "@/render/pages/Genetec/stats/statsCollector";
import { statsTelemetry } from "@/render/pages/Genetec/stats/statsTelemetry";
import type { IPlayerStats } from "@/render/types/genetec";

describe("statsTelemetry", () => {
  beforeEach(() => {
    resetCollector();
    beginPhase("phase-1", jest.fn());
  });
  afterEach(() => endPhase());

  it("forwards player reports to the collector", () => {
    statsTelemetry.onStartRequested("cam-1");
    statsTelemetry.onStreamStatus("cam-1", 5, "Streaming");
    statsTelemetry.onError("cam-1", {
      code: 9,
      isFatal: false,
      message: "timeout",
      source: "gwp-error"
    });
    expect(getEvents().map((e) => [e.kind, e.cameraId])).toEqual([
      ["start-requested", "cam-1"],
      ["streamStatus", "cam-1"],
      ["error", "cam-1"]
    ]);
  });

  it("registers a stats source and returns its unregister function", async () => {
    const getter = jest.fn().mockResolvedValue({ fps: 25 } as IPlayerStats);
    const off = statsTelemetry.registerStatsSource("cam-1", getter);
    await pollOnce();
    expect(getSamples()).toHaveLength(1);
    off();
    await pollOnce();
    expect(getSamples()).toHaveLength(1);
  });

  it("records a camera-assigned event with cell and previous camera", () => {
    statsTelemetry.onCameraAssigned?.(2, "cam-9", "cam-3");
    statsTelemetry.onCameraAssigned?.(0, "cam-1", null);
    expect(getEvents()).toMatchObject([
      { kind: "camera-assigned", cellIndex: 2, cameraId: "cam-9", previousCameraId: "cam-3" },
      { kind: "camera-assigned", cellIndex: 0, cameraId: "cam-1", previousCameraId: null }
    ]);
  });

  it("does not record camera-assigned outside an active phase", () => {
    endPhase();
    statsTelemetry.onCameraAssigned?.(0, "cam-1", null);
    expect(getEvents()).toHaveLength(0);
  });
});

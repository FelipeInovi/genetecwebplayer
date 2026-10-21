import { ReactNode } from "react";
import { renderHook } from "@testing-library/react";
import {
  GenetecTelemetryContext,
  noopTelemetry,
  useGenetecTelemetry
} from "@/render/pages/Genetec/components/GenetecTelemetryContext";
import type { GenetecPlayerTelemetry } from "@/render/types/genetec";

describe("GenetecTelemetryContext", () => {
  it("defaults to a no-op telemetry that accepts every report", () => {
    const { result } = renderHook(() => useGenetecTelemetry());
    expect(result.current).toBe(noopTelemetry);
    expect(() => {
      noopTelemetry.onStartRequested("cam-1");
      noopTelemetry.onStreamStatus("cam-1", 5, "");
      noopTelemetry.onError("cam-1", {
        code: 0,
        isFatal: true,
        message: "x",
        source: "start"
      });
    }).not.toThrow();
  });

  it("no-op stats source registration returns a callable unregister", () => {
    const off = noopTelemetry.registerStatsSource("cam-1", jest.fn());
    expect(() => off()).not.toThrow();
  });

  it("returns the provided telemetry", () => {
    const telemetry: GenetecPlayerTelemetry = {
      onStartRequested: jest.fn(),
      onError: jest.fn(),
      onStreamStatus: jest.fn(),
      registerStatsSource: jest.fn(() => jest.fn())
    };
    const { result } = renderHook(() => useGenetecTelemetry(), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <GenetecTelemetryContext.Provider value={telemetry}>
          {children}
        </GenetecTelemetryContext.Provider>
      )
    });
    expect(result.current).toBe(telemetry);
  });
});

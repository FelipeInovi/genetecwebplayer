import { createContext, useContext } from "react";
import type { GenetecPlayerTelemetry } from "@/render/types/genetec";

const noop = () => undefined;

/** Default: the player reports to nobody. */
export const noopTelemetry: GenetecPlayerTelemetry = {
  onStartRequested: noop,
  onError: noop,
  onStreamStatus: noop,
  registerStatsSource: () => noop
};

/**
 * Optional. Provide a STABLE value (module constant or memoized): a new object
 * on every render would restart the players.
 */
export const GenetecTelemetryContext =
  createContext<GenetecPlayerTelemetry>(noopTelemetry);

export const useGenetecTelemetry = (): GenetecPlayerTelemetry =>
  useContext(GenetecTelemetryContext);

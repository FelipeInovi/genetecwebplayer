import {
  recordError,
  recordStart,
  recordStreamStatus,
  registerPlayer
} from "@/render/pages/Genetec/stats/statsCollector";
import type { GenetecPlayerTelemetry } from "@/render/types/genetec";

/** The load-test harness implementation of the player telemetry contract. */
export const statsTelemetry: GenetecPlayerTelemetry = {
  onStartRequested: recordStart,
  onError: recordError,
  onStreamStatus: recordStreamStatus,
  registerStatsSource: registerPlayer
};

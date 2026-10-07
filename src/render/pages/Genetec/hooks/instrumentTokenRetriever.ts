import { toError } from "@/render/service/errors";
import type {
  GenetecPlayerTelemetry,
  GwpGetTokenFct
} from "@/render/types/genetec";

// Errors already reported to the telemetry: lets the player hook skip a second
// report when GWP rejects start() with the very error the retriever threw.
const recorded = new WeakSet<object>();

export const wasErrorRecorded = (e: unknown): boolean =>
  typeof e === "object" && e !== null && recorded.has(e);

interface Options {
  telemetry: GenetecPlayerTelemetry;
  /** GWP passes the camera GUID; telemetry is keyed by our camera id. */
  resolveCameraId: (cameraGuid: string) => string | undefined;
  /** True once the camera reached Streaming: later failures are renewals. */
  hasStreamed: (cameraId: string) => boolean;
  /** Called for failures before the first Streaming (the cell cannot start). */
  onStartFailure?: (error: unknown, cameraId: string) => void;
}

/**
 * Wraps a token retriever (the same one in individual and multiplexed mode) so
 * every failure is reported and rethrown to GWP unchanged:
 * - before first Streaming: source "token" (the cell fails through onStartFailure);
 * - after Streaming: source "token-renewal" (the cell keeps playing).
 */
export const instrumentTokenRetriever =
  (base: GwpGetTokenFct, options: Options): GwpGetTokenFct =>
  async (cameraGuid) => {
    try {
      return await base(cameraGuid);
    } catch (e) {
      const cameraId = options.resolveCameraId(cameraGuid);
      if (cameraId) {
        const renewal = options.hasStreamed(cameraId);
        options.telemetry.onError(cameraId, {
          code: 0,
          isFatal: !renewal,
          message: toError(e).message,
          source: renewal ? "token-renewal" : "token"
        });
        if (typeof e === "object" && e !== null) recorded.add(e);
        if (!renewal) options.onStartFailure?.(e, cameraId);
      }
      throw e;
    }
  };

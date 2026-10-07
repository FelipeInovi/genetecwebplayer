import { useStatsStore } from "@/render/pages/Genetec/stats/statsStore";
import type { GwpGetTokenFct } from "@/render/types/genetec";

// Errors already written to the stats store: lets the player hook skip a second
// record when GWP rejects start() with the very error the retriever threw.
const recorded = new WeakSet<object>();

export const wasErrorRecorded = (e: unknown): boolean =>
  typeof e === "object" && e !== null && recorded.has(e);

interface Options {
  /** GWP passes the camera GUID; stats are keyed by our camera id. */
  resolveCameraId: (cameraGuid: string) => string | undefined;
  /** True once the camera reached Streaming: later failures are renewals. */
  hasStreamed: (cameraId: string) => boolean;
  /** Called for failures before the first Streaming (the cell cannot start). */
  onStartFailure?: (error: unknown, cameraId: string) => void;
}

/**
 * Wraps a token retriever (the same one in individual and multiplexed mode) so
 * every failure is recorded and rethrown to GWP unchanged:
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
        useStatsStore.getState().recordError(cameraId, {
          code: 0,
          isFatal: !renewal,
          message: e instanceof Error ? e.message : String(e),
          source: renewal ? "token-renewal" : "token"
        });
        if (typeof e === "object" && e !== null) recorded.add(e);
        if (!renewal) options.onStartFailure?.(e, cameraId);
      }
      throw e;
    }
  };

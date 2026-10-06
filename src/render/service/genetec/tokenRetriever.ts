import type {
  GenetecTokenResponse,
  GwpGetTokenFct
} from "@/render/types/genetec";

const DEFAULT_MARGIN_MS = 15_000;

interface CacheEntry {
  token: string;
  expiresAtMs: number;
}

interface Options {
  fetchToken: (cameraId: string) => Promise<GenetecTokenResponse>;
  /** GWP passes the camera GUID; our backend is keyed by our camera id. */
  resolveCameraId: (cameraGuid: string) => string | undefined;
  now?: () => number;
  /** Refresh this long before expiresAt. */
  marginMs?: number;
}

/**
 * GWP token retriever with a per-camera cache.
 * Cache key: the camera GUID (what GWP passes), mapped to our id for the backend.
 * - Honors expiresAt minus a safety margin.
 * - Concurrent calls for one camera share a single in-flight request.
 * - Failures are rethrown and never cached.
 */
export const createTokenRetriever = ({
  fetchToken,
  resolveCameraId,
  now = Date.now,
  marginMs = DEFAULT_MARGIN_MS
}: Options): GwpGetTokenFct => {
  const cache = new Map<string, CacheEntry>();
  const inFlight = new Map<string, Promise<string>>();

  return (cameraGuid) => {
    const cached = cache.get(cameraGuid);
    if (cached && cached.expiresAtMs - marginMs > now()) {
      return Promise.resolve(cached.token);
    }
    const pending = inFlight.get(cameraGuid);
    if (pending) return pending;

    const cameraId = resolveCameraId(cameraGuid);
    if (!cameraId) {
      return Promise.reject(new Error(`Unknown camera GUID: ${cameraGuid}`));
    }

    const request = fetchToken(cameraId)
      .then((res) => {
        const expiresAtMs = new Date(res.expiresAt).getTime();
        if (Number.isFinite(expiresAtMs)) {
          cache.set(cameraGuid, { token: res.token, expiresAtMs });
        } else {
          cache.delete(cameraGuid);
        }
        return res.token;
      })
      .finally(() => inFlight.delete(cameraGuid));
    inFlight.set(cameraGuid, request);
    return request;
  };
};

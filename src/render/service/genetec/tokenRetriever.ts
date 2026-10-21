import type {
  GenetecTokenResponse,
  GwpGetTokenFct
} from "@/render/types/genetec";

const DEFAULT_MARGIN_MS = 15_000;
/** Random extra margin per camera so renewals do not all hit the backend at once. */
const DEFAULT_JITTER_MS = 10_000;
const DEFAULT_MAX_CONCURRENT = 4;
/** Waits before retry 1 and retry 2 (so at most 3 attempts per fetch). */
const DEFAULT_RETRY_DELAYS_MS: readonly number[] = [500, 1500];
const RETRYABLE_STATUSES: ReadonlySet<number> = new Set([502, 503, 504]);

interface CacheEntry {
  token: string;
  expiresAtMs: number;
  /** Margin plus this camera's jitter. */
  refreshMarginMs: number;
}

interface Options {
  fetchToken: (cameraId: string) => Promise<GenetecTokenResponse>;
  /** GWP passes the camera GUID; our backend is keyed by our camera id. */
  resolveCameraId: (cameraGuid: string) => string | undefined;
  now?: () => number;
  /** Refresh this long before expiresAt (plus jitter). */
  marginMs?: number;
  /** Upper bound of the random jitter added to the margin. */
  jitterMs?: number;
  /** Injectable RNG returning [0, 1). */
  rng?: () => number;
  /** Max concurrent in-flight token fetches; the rest queue. */
  maxConcurrent?: number;
  /** Backoff delays between attempts. */
  retryDelaysMs?: readonly number[];
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Transient failures worth one more try: no HTTP response at all (network)
 * or a 502/503/504. Anything else (403, 401, 404, plain Errors) is final.
 */
export const isRetryableTokenError = (error: unknown): boolean => {
  if (typeof error !== "object" || error === null) return false;
  const e = error as {
    isAxiosError?: boolean;
    code?: string;
    response?: { status?: number };
  };
  if (e.response?.status !== undefined) {
    return RETRYABLE_STATUSES.has(e.response.status);
  }
  return e.isAxiosError === true || e.code === "ERR_NETWORK";
};

/**
 * GWP token retriever with a per-camera cache.
 * Cache key: the camera GUID (what GWP passes), mapped to our id for the backend.
 * - Honors expiresAt minus a safety margin plus per-camera random jitter.
 * - Concurrent calls for one camera share a single in-flight request.
 * - At most `maxConcurrent` backend fetches run at once; the rest queue.
 * - Transient failures are retried with backoff; failures are never cached.
 */
export const createTokenRetriever = ({
  fetchToken,
  resolveCameraId,
  now = Date.now,
  marginMs = DEFAULT_MARGIN_MS,
  jitterMs = DEFAULT_JITTER_MS,
  rng = Math.random,
  maxConcurrent = DEFAULT_MAX_CONCURRENT,
  retryDelaysMs = DEFAULT_RETRY_DELAYS_MS,
  sleep = defaultSleep
}: Options): GwpGetTokenFct => {
  const cache = new Map<string, CacheEntry>();
  const inFlight = new Map<string, Promise<string>>();
  const queue: Array<() => void> = [];
  let active = 0;

  const release = () => {
    const next = queue.shift();
    if (next) next(); // The slot passes directly to the next waiter.
    else active -= 1;
  };

  const fetchWithRetry = async (
    cameraId: string
  ): Promise<GenetecTokenResponse> => {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await fetchToken(cameraId);
      } catch (e) {
        if (attempt >= retryDelaysMs.length || !isRetryableTokenError(e)) {
          throw e;
        }
        await sleep(retryDelaysMs[attempt]);
      }
    }
  };

  const fetchLimited = async (
    cameraId: string
  ): Promise<GenetecTokenResponse> => {
    // Fast path is synchronous: no await while a slot is free.
    if (active < maxConcurrent) active += 1;
    else await new Promise<void>((resolve) => queue.push(resolve));
    try {
      return await fetchWithRetry(cameraId);
    } finally {
      release();
    }
  };

  return (cameraGuid) => {
    const cached = cache.get(cameraGuid);
    if (cached && cached.expiresAtMs - cached.refreshMarginMs > now()) {
      return Promise.resolve(cached.token);
    }
    const pending = inFlight.get(cameraGuid);
    if (pending) return pending;

    const cameraId = resolveCameraId(cameraGuid);
    if (!cameraId) {
      return Promise.reject(new Error(`Unknown camera GUID: ${cameraGuid}`));
    }

    const request = fetchLimited(cameraId)
      .then((res) => {
        const expiresAtMs = new Date(res.expiresAt).getTime();
        if (Number.isFinite(expiresAtMs)) {
          cache.set(cameraGuid, {
            token: res.token,
            expiresAtMs,
            refreshMarginMs: marginMs + rng() * jitterMs
          });
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

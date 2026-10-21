import { getMediaEndpoint } from "@/render/service/genetec/mediaEndpoint";
import type { GwpGlobal } from "@/render/types/genetec";

const DEFAULT_TIMEOUT_MS = 15_000;
const cache = new Map<string, Promise<GwpGlobal>>();

const normalize = (url: string) => url.replace(/\/+$/, "");

/** Idempotent: one script tag and one promise per Media Gateway URL. */
export const loadGwpScript = (
  mediaGatewayUrl: string,
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<GwpGlobal> => {
  const base = normalize(mediaGatewayUrl);
  const cached = cache.get(base);
  if (cached) return cached;

  const src = `${getMediaEndpoint(base)}/v2/files/gwp.js`;
  const promise = new Promise<GwpGlobal>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.dataset.gwp = base;

    const timer = setTimeout(
      () => fail(new Error(`Timed out loading GWP script from ${src}`)),
      timeoutMs
    );
    const fail = (error: Error) => {
      clearTimeout(timer);
      script.remove();
      cache.delete(base);
      reject(error);
    };

    script.addEventListener("load", () => {
      clearTimeout(timer);
      if (window.gwp) resolve(window.gwp);
      else fail(new Error("GWP script loaded but the gwp global is missing"));
    });
    script.addEventListener("error", () =>
      fail(new Error(`Failed to load GWP script from ${src}`))
    );
    document.head.appendChild(script);
  });

  cache.set(base, promise);
  return promise;
};

export const resetGwpLoaderForTests = () => cache.clear();

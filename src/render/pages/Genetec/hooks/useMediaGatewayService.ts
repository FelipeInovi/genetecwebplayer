import { useEffect, useMemo, useRef, useState } from "react";
import config from "@/render/config/poc.config";
import type { GenetecServiceValue } from "@/render/pages/Genetec/components/GenetecServiceContext";
import { instrumentTokenRetriever } from "@/render/pages/Genetec/hooks/instrumentTokenRetriever";
import { loadGwpScript } from "@/render/pages/Genetec/hooks/loadGwpScript";
import { hasCameraStreamed } from "@/render/pages/Genetec/stats/statsStore";
import { getGenetecToken } from "@/render/service/genetec/genetecService";
import { getMediaEndpoint } from "@/render/service/genetec/mediaEndpoint";
import { createTokenRetriever } from "@/render/service/genetec/tokenRetriever";
import type {
  GenetecCamera,
  IMediaGatewayService
} from "@/render/types/genetec";

const disposeService = (service: IMediaGatewayService) => {
  try {
    // TODO verify against gwp.d.ts: IMediaGatewayService has no documented dispose.
    service.dispose?.();
  } catch {
    // Nothing else to release.
  }
};

/**
 * Owns the shared IMediaGatewayService of a mosaic (multiplexed mode).
 * One service per multiplexed mosaic; disposed on unmount or mode change.
 * In mock mode no service exists, the value is just "ready".
 */
export const useMediaGatewayService = (
  multiplexed: boolean,
  cameras: GenetecCamera[]
): GenetecServiceValue => {
  const isGwp = config.genetecPlayerMode === "gwp";
  const guidToId = useRef(new Map<string, string>());
  guidToId.current = new Map(cameras.map((c) => [c.externalId, c.id]));

  // One retriever for the whole page in individual mode: global concurrency cap + one cache.
  const sharedRetriever = useMemo(
    () =>
      createTokenRetriever({
        fetchToken: getGenetecToken,
        resolveCameraId: (guid) => guidToId.current.get(guid)
      }),
    []
  );

  const [built, setBuilt] = useState<{
    service: IMediaGatewayService | null;
    error: Error | null;
  }>({ service: null, error: null });

  useEffect(() => {
    if (!multiplexed || !isGwp) return;
    let cancelled = false;
    let current: IMediaGatewayService | null = null;
    setBuilt({ service: null, error: null });

    const resolveCameraId = (guid: string) => guidToId.current.get(guid);
    // Same retriever path as individual mode; renewal failures are recorded too.
    const retriever = instrumentTokenRetriever(
      createTokenRetriever({ fetchToken: getGenetecToken, resolveCameraId }),
      { resolveCameraId, hasStreamed: hasCameraStreamed }
    );

    loadGwpScript(config.mediaGatewayUrl)
      .then((gwp) =>
        gwp.buildMediaGatewayService(
          getMediaEndpoint(config.mediaGatewayUrl),
          retriever
        )
      )
      .then((service) => {
        if (cancelled) {
          disposeService(service);
          return;
        }
        current = service;
        setBuilt({ service, error: null });
      })
      .catch((e: unknown) => {
        if (!cancelled)
          setBuilt({
            service: null,
            error: e instanceof Error ? e : new Error(String(e))
          });
      });

    return () => {
      cancelled = true;
      if (current) disposeService(current);
      setBuilt({ service: null, error: null });
    };
  }, [multiplexed, isGwp]);

  return useMemo(() => {
    const individual: GenetecServiceValue = {
      multiplexed: false,
      service: null,
      ready: true,
      error: null,
      tokenRetriever: sharedRetriever
    };
    if (!multiplexed) return individual;
    if (!isGwp) return { ...individual, multiplexed: true };
    return {
      multiplexed: true,
      service: built.service,
      ready: built.service !== null || built.error !== null,
      error: built.error
    };
  }, [multiplexed, isGwp, built, sharedRetriever]);
};

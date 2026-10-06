import { useEffect, useMemo, useRef, useState } from "react";
import config from "@/render/config/poc.config";
import type { GenetecServiceValue } from "@/render/pages/Genetec/components/GenetecServiceContext";
import { loadGwpScript } from "@/render/pages/Genetec/hooks/loadGwpScript";
import { getGenetecToken } from "@/render/service/genetec/genetecService";
import { getMediaEndpoint } from "@/render/service/genetec/mediaEndpoint";
import { createTokenRetriever } from "@/render/service/genetec/tokenRetriever";
import type {
  GenetecCamera,
  IMediaGatewayService
} from "@/render/types/genetec";

const INDIVIDUAL: GenetecServiceValue = {
  multiplexed: false,
  service: null,
  ready: true,
  error: null
};

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

  const [built, setBuilt] = useState<{
    service: IMediaGatewayService | null;
    error: Error | null;
  }>({ service: null, error: null });

  useEffect(() => {
    if (!multiplexed || !isGwp) return;
    let cancelled = false;
    let current: IMediaGatewayService | null = null;
    setBuilt({ service: null, error: null });

    const retriever = createTokenRetriever({
      fetchToken: getGenetecToken,
      resolveCameraId: (guid) => guidToId.current.get(guid)
    });

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
    if (!multiplexed) return INDIVIDUAL;
    if (!isGwp) return { ...INDIVIDUAL, multiplexed: true };
    return {
      multiplexed: true,
      service: built.service,
      ready: built.service !== null || built.error !== null,
      error: built.error
    };
  }, [multiplexed, isGwp, built]);
};

import { useEffect, useMemo, useRef, useState } from "react";
import config from "@/render/config/poc.config";
import type { GenetecServiceValue } from "@/render/pages/Genetec/components/GenetecServiceContext";
import { useGenetecTelemetry } from "@/render/pages/Genetec/components/GenetecTelemetryContext";
import { instrumentTokenRetriever } from "@/render/pages/Genetec/hooks/instrumentTokenRetriever";
import { loadGwpScript } from "@/render/pages/Genetec/hooks/loadGwpScript";
import { hasStreamed } from "@/render/pages/Genetec/hooks/streamedCameras";
import { toError } from "@/render/service/errors";
import { getGenetecToken } from "@/render/service/genetec/genetecService";
import { getMediaEndpoint } from "@/render/service/genetec/mediaEndpoint";
import { createTokenRetriever } from "@/render/service/genetec/tokenRetriever";
import type {
  GenetecCamera,
  IMediaGatewayService
} from "@/render/types/genetec";

interface BuiltService {
  service: IMediaGatewayService | null;
  error: Error | null;
}

/** Constant, so resetting to it never triggers a re-render when already empty. */
const NOT_BUILT: BuiltService = { service: null, error: null };

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
  // POC-only: mock mode needs no service (the mock player ignores it).
  const isGwp = config.genetecPlayerMode === "gwp";
  const telemetry = useGenetecTelemetry();
  // The map is rebuilt only when the camera list changes; the ref lets the
  // long-lived retrievers read the latest one.
  const guidToIdMap = useMemo(
    () => new Map(cameras.map((c) => [c.externalId, c.id])),
    [cameras]
  );
  const guidToId = useRef(guidToIdMap);
  guidToId.current = guidToIdMap;

  // One retriever for the whole page in individual mode: global concurrency cap + one cache.
  const sharedRetriever = useMemo(
    () =>
      createTokenRetriever({
        fetchToken: getGenetecToken,
        resolveCameraId: (guid) => guidToId.current.get(guid)
      }),
    []
  );

  const [built, setBuilt] = useState<BuiltService>(NOT_BUILT);

  useEffect(() => {
    // Runs on every mode change, so a disposed service never outlives its run.
    setBuilt(NOT_BUILT);
    if (!multiplexed || !isGwp) return;
    let cancelled = false;
    let current: IMediaGatewayService | null = null;

    const resolveCameraId = (guid: string) => guidToId.current.get(guid);
    // Same retriever path as individual mode; renewal failures are recorded too.
    const retriever = instrumentTokenRetriever(
      createTokenRetriever({ fetchToken: getGenetecToken, resolveCameraId }),
      { telemetry, resolveCameraId, hasStreamed }
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
          setBuilt({ service: null, error: toError(e) });
      });

    return () => {
      cancelled = true;
      if (current) disposeService(current);
    };
  }, [multiplexed, isGwp, telemetry]);

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

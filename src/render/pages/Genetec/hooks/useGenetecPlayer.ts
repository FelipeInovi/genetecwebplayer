import { RefObject, useContext, useEffect, useReducer, useRef } from "react";
import config from "@/render/config/poc.config";
import { GenetecServiceContext } from "@/render/pages/Genetec/components/GenetecServiceContext";
import { useGenetecTelemetry } from "@/render/pages/Genetec/components/GenetecTelemetryContext";
import {
  attachGwpPlayer,
  attachMockPlayer
} from "@/render/pages/Genetec/hooks/attachPlayer";
import {
  initialPlayerState,
  playerReducer,
  type PlayerState
} from "@/render/pages/Genetec/hooks/playerReducer";
import {
  createPlayerSession,
  type Disposable,
  type PlayerParams
} from "@/render/pages/Genetec/hooks/playerSession";
import { CameraOfflineError } from "@/render/service/errors";
import type { GenetecCamera } from "@/render/types/genetec";

export type UseGenetecPlayerResult = PlayerState;

export const useGenetecPlayer = (
  containerRef: RefObject<HTMLElement>,
  camera: GenetecCamera | null
): UseGenetecPlayerResult => {
  const {
    multiplexed,
    service,
    ready,
    error: serviceError,
    tokenRetriever: sharedTokenRetriever,
    debugOverlay = false
  } = useContext(GenetecServiceContext);
  const telemetry = useGenetecTelemetry();
  const playerRef = useRef<Disposable | null>(null);
  const debugOverlayRef = useRef(debugOverlay);

  // Primitives only: a new camera object with the same values must not restart the player.
  const id = camera?.id;
  const externalId = camera?.externalId;
  const name = camera?.name;
  const status = camera?.status;

  const [state, dispatch] = useReducer(
    playerReducer,
    camera !== null,
    initialPlayerState
  );

  // Declared before the start effect: the flag must be current when a player attaches.
  useEffect(() => {
    debugOverlayRef.current = debugOverlay;
    playerRef.current?.showDebugOverlay(debugOverlay);
  }, [debugOverlay]);

  useEffect(() => {
    const container = containerRef.current;
    if (!id || !externalId || !name || !container) {
      dispatch({ type: "RESET" });
      return;
    }
    const params: PlayerParams = { id, externalId, name, status };
    if (params.status === "offline") {
      const offline = new CameraOfflineError();
      telemetry.onError(id, {
        code: 0,
        isFatal: true,
        message: offline.message,
        source: "offline"
      });
      dispatch({ type: "FAIL", error: offline });
      return;
    }

    dispatch({ type: "START" });
    const session = createPlayerSession({
      params,
      telemetry,
      dispatch,
      playerRef,
      debugOverlay: () => debugOverlayRef.current
    });
    // POC-only: the mock branch needs no Media Gateway.
    if (config.genetecPlayerMode === "mock") {
      attachMockPlayer(session, container);
    } else {
      attachGwpPlayer(session, {
        container,
        multiplexed,
        service,
        ready,
        serviceError,
        sharedTokenRetriever
      });
    }
    return session.cleanup;
  }, [
    containerRef,
    id,
    externalId,
    name,
    status,
    multiplexed,
    service,
    ready,
    serviceError,
    sharedTokenRetriever,
    telemetry
  ]);

  return state;
};

import {
  RefObject,
  useContext,
  useEffect,
  useRef,
  useState
} from "react";
import config from "@/render/config/poc.config";
import { GenetecServiceContext } from "@/render/pages/Genetec/components/GenetecServiceContext";
import { createMockPlayer } from "@/render/pages/Genetec/components/MockPlayer";
import { loadGwpScript } from "@/render/pages/Genetec/hooks/loadGwpScript";
import {
  registerPlayer,
  useStatsStore
} from "@/render/pages/Genetec/stats/statsStore";
import { CameraOfflineError, GwpPlayerError } from "@/render/service/errors";
import { getGenetecToken } from "@/render/service/genetec/genetecService";
import { getMediaEndpoint } from "@/render/service/genetec/mediaEndpoint";
import { createTokenRetriever } from "@/render/service/genetec/tokenRetriever";
import {
  StreamingConnectionStatus,
  type GenetecCamera,
  type GwpErrorState,
  type GwpPlayer,
  type GwpStreamStatus,
  type PlayerStatus
} from "@/render/types/genetec";

const MOCK_START_DELAY_MS = 300;

/**
 * Stream statuses after which the docs say: stop(), report, do not retry.
 * (docs/genetec/gwp-reference.md section 11.)
 */
const NON_RECOVERABLE_STATUSES: ReadonlySet<number> = new Set([
  StreamingConnectionStatus.NotEnoughBandwidth,
  StreamingConnectionStatus.MediaRouterStreamNotFound,
  StreamingConnectionStatus.StreamUnreachable,
  StreamingConnectionStatus.UnauthorizedToken
]);

interface Disposable {
  stop: () => void;
  dispose: () => void;
  showDebugOverlay: (show: boolean) => void;
}

export interface UseGenetecPlayerResult {
  status: PlayerStatus;
  /**
   * In "error" status: the cause. While "playing": the last non-fatal player
   * error (informational), or null.
   */
  error: Error | null;
}

const toError = (e: unknown): Error =>
  e instanceof Error ? e : new Error(String(e));

export const useGenetecPlayer = (
  containerRef: RefObject<HTMLElement>,
  camera: GenetecCamera | null
): UseGenetecPlayerResult => {
  const { multiplexed, service, ready, error: serviceError } = useContext(
    GenetecServiceContext
  );
  const debugOverlay = useStatsStore((s) => s.debugOverlay);
  const playerRef = useRef<Disposable | null>(null);

  // Primitives only: a new camera object with the same values must not restart the player.
  const id = camera?.id;
  const externalId = camera?.externalId;
  const name = camera?.name;
  const cameraStatus = camera?.status;

  const [state, setState] = useState<UseGenetecPlayerResult>({
    status: camera ? "loading" : "idle",
    error: null
  });

  useEffect(() => {
    const container = containerRef.current;
    if (!id || !externalId || !name || !container) {
      setState((prev) =>
        prev.status === "idle" && !prev.error
          ? prev
          : { status: "idle", error: null }
      );
      return;
    }
    if (cameraStatus === "offline") {
      setState({ status: "error", error: new CameraOfflineError() });
      return;
    }

    let cancelled = false;
    let failed = false;
    let handle: Disposable | null = null;
    let startTimer: ReturnType<typeof setTimeout> | null = null;
    let unregisterStats: (() => void) | null = null;
    const unregisterHandlers: Array<() => void> = [];
    setState({ status: "loading", error: null });

    const fail = (e: unknown) => {
      if (cancelled) return;
      failed = true;
      setState({ status: "error", error: toError(e) });
    };
    const markPlaying = () => {
      if (cancelled || failed) return;
      setState((prev) =>
        prev.status === "playing" && !prev.error
          ? prev
          : { status: "playing", error: null }
      );
    };
    const markFrame = () => {
      if (cancelled || failed) return;
      setState((prev) =>
        prev.status === "loading" ? { status: "playing", error: null } : prev
      );
    };
    const markReconnecting = () => {
      if (cancelled || failed) return;
      setState((prev) =>
        prev.status === "loading" ? prev : { ...prev, status: "loading" }
      );
    };
    const store = () => useStatsStore.getState();

    const attach = (target: Disposable, getStats: GwpPlayer["getPlayerStats"]) => {
      handle = target;
      playerRef.current = target;
      unregisterStats = registerPlayer(id, getStats);
      if (store().debugOverlay) target.showDebugOverlay(true);
    };

    if (config.genetecPlayerMode === "mock") {
      startTimer = setTimeout(() => {
        const mock = createMockPlayer(container, name);
        attach(mock, mock.getPlayerStats);
        store().recordStreamStatus(id, StreamingConnectionStatus.Streaming, "mock");
        markPlaying();
      }, MOCK_START_DELAY_MS);
    } else if (multiplexed && serviceError) {
      fail(serviceError);
    } else if (multiplexed && !ready) {
      // Shared service still being built: stay in "loading".
    } else {
      const baseRetriever = createTokenRetriever({
        fetchToken: getGenetecToken,
        resolveCameraId: (guid) => (guid === externalId ? id : undefined)
      });
      // Token failures after start (renewals) would otherwise stay invisible to React.
      const tokenRetriever = async (guid: string) => {
        try {
          return await baseRetriever(guid);
        } catch (e) {
          fail(e);
          throw e;
        }
      };

      loadGwpScript(config.mediaGatewayUrl)
        .then(async (gwp) => {
          if (cancelled) return;
          const player = gwp.buildPlayer(container);
          attach(player, () => player.getPlayerStats());

          const onStreamStatus = (e: GwpStreamStatus) => {
            store().recordStreamStatus(id, e.state, e.value);
            if (NON_RECOVERABLE_STATUSES.has(e.state)) {
              try {
                player.stop();
              } catch {
                // Already stopped.
              }
              fail(
                new GwpPlayerError(
                  e.value || `Stream status ${e.state}`,
                  e.state,
                  true
                )
              );
            } else if (e.state === StreamingConnectionStatus.Streaming) {
              markPlaying();
            } else if (
              e.state === StreamingConnectionStatus.ConnectingToMediaGateway
            ) {
              markReconnecting();
            }
          };
          const onError = (e: GwpErrorState) => {
            store().recordError(id, {
              code: e.errorCode,
              isFatal: e.isFatal,
              message: e.value
            });
            const err = new GwpPlayerError(e.value, e.errorCode, e.isFatal);
            if (e.isFatal) fail(err);
            else if (!cancelled && !failed)
              setState((prev) => ({ ...prev, error: err }));
          };
          const onFrame = () => markFrame();

          // Handlers must exist BEFORE start().
          player.onStreamStatusChanged.register(onStreamStatus);
          player.onErrorStateRaised.register(onError);
          player.onFrameRendered.register(onFrame);
          unregisterHandlers.push(
            () => player.onStreamStatusChanged.unregister(onStreamStatus),
            () => player.onErrorStateRaised.unregister(onError),
            () => player.onFrameRendered.unregister(onFrame)
          );

          if (multiplexed) {
            if (!service) throw new Error("Media Gateway service unavailable");
            await player.startWithService(externalId, service);
          } else {
            await player.start(
              externalId,
              getMediaEndpoint(config.mediaGatewayUrl),
              tokenRetriever
            );
          }
          if (cancelled) return;
          // start() only opens the connection: "playing" waits for Streaming / first frame.
          player.playLive();
        })
        .catch(fail);
    }

    return () => {
      cancelled = true;
      if (startTimer) clearTimeout(startTimer);
      unregisterStats?.();
      unregisterHandlers.forEach((off) => {
        try {
          off();
        } catch {
          // Player may already be torn down.
        }
      });
      playerRef.current = null;
      if (handle) {
        try {
          handle.stop();
          handle.dispose();
        } catch {
          // Player may already be torn down; nothing else to release.
        }
      }
    };
  }, [
    containerRef,
    id,
    externalId,
    name,
    cameraStatus,
    multiplexed,
    service,
    ready,
    serviceError
  ]);

  useEffect(() => {
    playerRef.current?.showDebugOverlay(debugOverlay);
  }, [debugOverlay]);

  return state;
};

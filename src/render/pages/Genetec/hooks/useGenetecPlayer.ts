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
  instrumentTokenRetriever,
  wasErrorRecorded
} from "@/render/pages/Genetec/hooks/instrumentTokenRetriever";
import {
  forgetCamera,
  registerPlayer,
  useStatsStore
} from "@/render/pages/Genetec/stats/statsStore";
import { CameraOfflineError, GwpPlayerError } from "@/render/service/errors";
import { getGenetecToken } from "@/render/service/genetec/genetecService";
import { getMediaEndpoint } from "@/render/service/genetec/mediaEndpoint";
import { createTokenRetriever } from "@/render/service/genetec/tokenRetriever";
import type { ErrorSource } from "@/render/types/genetecMetrics";
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
  const {
    multiplexed,
    service,
    ready,
    error: serviceError,
    tokenRetriever: sharedTokenRetriever
  } = useContext(GenetecServiceContext);
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
      const offline = new CameraOfflineError();
      useStatsStore.getState().recordError(id, {
        code: 0,
        isFatal: true,
        message: offline.message,
        source: "offline"
      });
      setState({ status: "error", error: offline });
      return;
    }

    let cancelled = false;
    let failed = false;
    let streamed = false;
    let deadline: ReturnType<typeof setTimeout> | null = null;
    let handle: Disposable | null = null;
    let startTimer: ReturnType<typeof setTimeout> | null = null;
    let unregisterStats: (() => void) | null = null;
    const unregisterHandlers: Array<() => void> = [];
    setState({ status: "loading", error: null });

    const clearDeadline = () => {
      if (deadline) clearTimeout(deadline);
      deadline = null;
    };
    /** Fails the cell once: records it (unless already recorded) and shows it. */
    /**
     * Stops polling the cell and releases its player (idempotent: the handle is
     * taken, so a later failure, timeout or unmount cannot stop/dispose twice).
     */
    const release = () => {
      unregisterStats?.();
      unregisterStats = null;
      const target = handle;
      handle = null;
      playerRef.current = null;
      if (!target) return;
      try {
        target.stop();
        target.dispose();
      } catch {
        // Player may already be torn down.
      }
    };
    const fail = (e: unknown, source: ErrorSource, record = true) => {
      if (cancelled || failed) return;
      failed = true;
      clearDeadline();
      release();
      const err = toError(e);
      if (record && !wasErrorRecorded(e)) {
        store().recordError(id, {
          code: err instanceof GwpPlayerError ? err.code : 0,
          isFatal: true,
          message: err.message,
          source
        });
      }
      setState({ status: "error", error: err });
    };
    const markPlaying = () => {
      if (cancelled || failed) return;
      streamed = true;
      clearDeadline();
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
      store().recordStart(id);
      fail(serviceError, "service-build");
    } else if (multiplexed && !ready) {
      // Shared service still being built: stay in "loading".
    } else {
      store().recordStart(id);
      // Same retriever path in individual and multiplexed mode (see useMediaGatewayService).
      const resolveCameraId = (guid: string) =>
        guid === externalId ? id : undefined;
      // One shared retriever (cache + concurrency queue) per page when the
      // provider supplies it; a private one otherwise (no provider, e.g. tests).
      const baseRetriever =
        sharedTokenRetriever ??
        createTokenRetriever({ fetchToken: getGenetecToken, resolveCameraId });
      const tokenRetriever = instrumentTokenRetriever(
        baseRetriever,
        {
          resolveCameraId,
          hasStreamed: () => streamed,
          onStartFailure: (e) => fail(e, "token")
        }
      );

      deadline = setTimeout(() => {
        deadline = null;
        if (cancelled || failed || streamed) return;
        fail(
          new Error(`Start timed out after ${config.startTimeoutMs} ms`),
          "start-timeout"
        );
      }, config.startTimeoutMs);

      loadGwpScript(config.mediaGatewayUrl).then(
        async (gwp) => {
          // A start timeout may have fired while the script loaded: no zombie player.
          if (cancelled || failed) return;
          try {
            const player = gwp.buildPlayer(container);
            attach(player, () => player.getPlayerStats());

            const onStreamStatus = (e: GwpStreamStatus) => {
              if (cancelled) return;
              store().recordStreamStatus(id, e.state, e.value);
              if (NON_RECOVERABLE_STATUSES.has(e.state)) {
                fail(
                  new GwpPlayerError(
                    e.value || `Stream status ${e.state}`,
                    e.state,
                    true
                  ),
                  "fatal-status"
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
              if (cancelled) return;
              const err = new GwpPlayerError(e.value, e.errorCode, e.isFatal);
              store().recordError(id, {
                code: e.errorCode,
                isFatal: e.isFatal,
                message: e.value,
                source: "gwp-error"
              });
              if (e.isFatal) fail(err, "gwp-error", false);
              else if (!failed) setState((prev) => ({ ...prev, error: err }));
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
              if (!service) {
                throw Object.assign(
                  new Error("Media Gateway service unavailable"),
                  { stage: "service-build" }
                );
              }
              await player.startWithService(externalId, service);
            } else {
              await player.start(
                externalId,
                getMediaEndpoint(config.mediaGatewayUrl),
                tokenRetriever
              );
            }
            if (cancelled || failed) return;
            // start() only opens the connection: "playing" waits for Streaming / first frame.
            player.playLive();
          } catch (e) {
            const stage = (e as { stage?: ErrorSource }).stage;
            fail(e, stage ?? "start");
          }
        },
        (e: unknown) => fail(e, "script-load")
      );
    }

    return () => {
      cancelled = true;
      clearDeadline();
      forgetCamera(id);
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
    serviceError,
    sharedTokenRetriever
  ]);

  useEffect(() => {
    playerRef.current?.showDebugOverlay(debugOverlay);
  }, [debugOverlay]);

  return state;
};

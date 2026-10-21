import config from "@/render/config/poc.config";
import { instrumentTokenRetriever } from "@/render/pages/Genetec/hooks/instrumentTokenRetriever";
import { loadGwpScript } from "@/render/pages/Genetec/hooks/loadGwpScript";
import type { PlayerSession } from "@/render/pages/Genetec/hooks/playerSession";
import { createMockPlayer } from "@/render/pages/Genetec/components/MockPlayer";
import { GwpPlayerError } from "@/render/service/errors";
import { getGenetecToken } from "@/render/service/genetec/genetecService";
import { getMediaEndpoint } from "@/render/service/genetec/mediaEndpoint";
import { createTokenRetriever } from "@/render/service/genetec/tokenRetriever";
import {
  StreamingConnectionStatus,
  type GwpErrorState,
  type GwpGetTokenFct,
  type GwpStreamStatus,
  type IMediaGatewayService
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

// POC-only: the mock player simulates GWP without a Media Gateway.
export const attachMockPlayer = (
  session: PlayerSession,
  container: HTMLElement
): void => {
  const timer = setTimeout(() => {
    const mock = createMockPlayer(container, session.params.name);
    session.attach(mock, mock.getPlayerStats);
    session.reportStreamStatus(StreamingConnectionStatus.Streaming, "mock");
    session.markPlaying();
  }, MOCK_START_DELAY_MS);
  session.onCleanup(() => clearTimeout(timer));
};

export interface GwpAttachEnv {
  container: HTMLElement;
  multiplexed: boolean;
  service: IMediaGatewayService | null;
  /** false while the shared service is still being built. */
  ready: boolean;
  serviceError: Error | null;
  /** Page-wide retriever (one cache + one queue); absent: a private one. */
  sharedTokenRetriever?: GwpGetTokenFct;
}

/** Builds the GWP player, registers its handlers BEFORE start() and starts it. */
export const attachGwpPlayer = (
  session: PlayerSession,
  env: GwpAttachEnv
): void => {
  const { id, externalId } = session.params;
  const { telemetry } = session;
  const { container, multiplexed, service, ready, serviceError } = env;

  if (multiplexed && serviceError) {
    telemetry.onStartRequested(id);
    session.fail(serviceError, "service-build");
    return;
  }
  // Shared service still being built: stay in "loading".
  if (multiplexed && !ready) return;

  telemetry.onStartRequested(id);
  // Same retriever path in individual and multiplexed mode (see useMediaGatewayService).
  const resolveCameraId = (guid: string) =>
    guid === externalId ? id : undefined;
  const baseRetriever =
    env.sharedTokenRetriever ??
    createTokenRetriever({ fetchToken: getGenetecToken, resolveCameraId });
  const tokenRetriever = instrumentTokenRetriever(baseRetriever, {
    telemetry,
    resolveCameraId,
    hasStreamed: session.hasStreamed,
    onStartFailure: (e) => session.fail(e, "token")
  });

  session.armDeadline(config.startTimeoutMs, () =>
    session.fail(
      new Error(`Start timed out after ${config.startTimeoutMs} ms`),
      "start-timeout"
    )
  );

  loadGwpScript(config.mediaGatewayUrl).then(
    async (gwp) => {
      // A start timeout may have fired while the script loaded: no zombie player.
      if (!session.isActive()) return;
      try {
        const player = gwp.buildPlayer(container);
        session.attach(player, () => player.getPlayerStats());

        const onStreamStatus = (e: GwpStreamStatus) => {
          if (session.isCancelled()) return;
          session.reportStreamStatus(e.state, e.value);
          if (NON_RECOVERABLE_STATUSES.has(e.state)) {
            session.fail(
              new GwpPlayerError(
                e.value || `Stream status ${e.state}`,
                e.state,
                true
              ),
              "fatal-status"
            );
          } else if (e.state === StreamingConnectionStatus.Streaming) {
            session.markPlaying();
          } else if (
            e.state === StreamingConnectionStatus.ConnectingToMediaGateway
          ) {
            session.markReconnecting();
          }
        };
        const onError = (e: GwpErrorState) => {
          if (session.isCancelled()) return;
          const err = new GwpPlayerError(e.value, e.errorCode, e.isFatal);
          telemetry.onError(id, {
            code: e.errorCode,
            isFatal: e.isFatal,
            message: e.value,
            source: "gwp-error"
          });
          if (e.isFatal) session.fail(err, "gwp-error", false);
          else session.markWarning(err);
        };
        const onFrame = () => session.markFrame();

        player.onStreamStatusChanged.register(onStreamStatus);
        player.onErrorStateRaised.register(onError);
        player.onFrameRendered.register(onFrame);
        session.onCleanup(() =>
          player.onStreamStatusChanged.unregister(onStreamStatus)
        );
        session.onCleanup(() => player.onErrorStateRaised.unregister(onError));
        session.onCleanup(() => player.onFrameRendered.unregister(onFrame));

        if (multiplexed) {
          if (!service) {
            session.fail(
              new Error("Media Gateway service unavailable"),
              "service-build"
            );
            return;
          }
          await player.startWithService(externalId, service);
        } else {
          await player.start(
            externalId,
            getMediaEndpoint(config.mediaGatewayUrl),
            tokenRetriever
          );
        }
        if (!session.isActive()) return;
        // start() only opens the connection: "playing" waits for Streaming / first frame.
        player.playLive();
      } catch (e) {
        session.fail(e, "start");
      }
    },
    (e: unknown) => session.fail(e, "script-load")
  );
};

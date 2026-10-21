import type { Dispatch, MutableRefObject } from "react";
import type { PlayerAction } from "@/render/pages/Genetec/hooks/playerReducer";
import { wasErrorRecorded } from "@/render/pages/Genetec/hooks/instrumentTokenRetriever";
import {
  forgetStreamed,
  markStreamed
} from "@/render/pages/Genetec/hooks/streamedCameras";
import { GwpPlayerError, toError } from "@/render/service/errors";
import {
  StreamingConnectionStatus,
  type ErrorSource,
  type GenetecCameraStatus,
  type GenetecPlayerTelemetry,
  type GwpPlayer
} from "@/render/types/genetec";

export interface Disposable {
  stop: () => void;
  dispose: () => void;
  showDebugOverlay: (show: boolean) => void;
}

/** Stable primitives of the camera: the only inputs that may restart a player. */
export interface PlayerParams {
  id: string;
  externalId: string;
  name: string;
  status: GenetecCameraStatus | undefined;
}

interface SessionOptions {
  params: PlayerParams;
  telemetry: GenetecPlayerTelemetry;
  dispatch: Dispatch<PlayerAction>;
  playerRef: MutableRefObject<Disposable | null>;
  /** Read at attach time, so the flag set before the player existed still applies. */
  debugOverlay: () => boolean;
}

/**
 * Lifecycle of ONE start attempt (one run of the hook effect). It owns the
 * `cancelled || failed` guard and the release of the player, so no handler
 * has to repeat them.
 */
export interface PlayerSession {
  readonly params: PlayerParams;
  readonly telemetry: GenetecPlayerTelemetry;
  isCancelled: () => boolean;
  /** Neither cancelled (cleanup ran) nor failed. */
  isActive: () => boolean;
  /** True once Streaming was reached in this session. */
  hasStreamed: () => boolean;
  attach: (target: Disposable, getStats: GwpPlayer["getPlayerStats"]) => void;
  /** Reports a StreamingConnectionStatus change (and remembers Streaming). */
  reportStreamStatus: (code: number, message: string) => void;
  /** Fails the cell once: releases the player, reports (unless already) and shows it. */
  fail: (e: unknown, source: ErrorSource, report?: boolean) => void;
  markPlaying: () => void;
  markFrame: () => void;
  markReconnecting: () => void;
  /** Non-fatal error: informational, the cell keeps its status. */
  markWarning: (error: Error) => void;
  /** Fails with the start deadline unless the stream reached Streaming first. */
  armDeadline: (ms: number, onTimeout: () => void) => void;
  /** Runs on cleanup, before the player is released. Errors are swallowed. */
  onCleanup: (fn: () => void) => void;
  cleanup: () => void;
}

export const createPlayerSession = ({
  params,
  telemetry,
  dispatch,
  playerRef,
  debugOverlay
}: SessionOptions): PlayerSession => {
  const { id } = params;
  let cancelled = false;
  let failed = false;
  let streamed = false;
  let deadline: ReturnType<typeof setTimeout> | null = null;
  let handle: Disposable | null = null;
  let unregisterStats: (() => void) | null = null;
  const cleanups: Array<() => void> = [];

  const active = () => !cancelled && !failed;
  const send = (action: PlayerAction) => {
    if (active()) dispatch(action);
  };
  const clearDeadline = () => {
    if (deadline) clearTimeout(deadline);
    deadline = null;
  };

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

  return {
    params,
    telemetry,
    isCancelled: () => cancelled,
    isActive: active,
    hasStreamed: () => streamed,

    attach: (target, getStats) => {
      handle = target;
      playerRef.current = target;
      unregisterStats = telemetry.registerStatsSource(id, getStats);
      if (debugOverlay()) target.showDebugOverlay(true);
    },

    reportStreamStatus: (code, message) => {
      if (code === StreamingConnectionStatus.Streaming) markStreamed(id);
      telemetry.onStreamStatus(id, code, message);
    },

    fail: (e, source, report = true) => {
      if (!active()) return;
      failed = true;
      clearDeadline();
      release();
      const err = toError(e);
      if (report && !wasErrorRecorded(e)) {
        telemetry.onError(id, {
          code: err instanceof GwpPlayerError ? err.code : 0,
          isFatal: true,
          message: err.message,
          source
        });
      }
      dispatch({ type: "FAIL", error: err });
    },

    markPlaying: () => {
      if (!active()) return;
      streamed = true;
      clearDeadline();
      dispatch({ type: "PLAYING" });
    },
    markFrame: () => send({ type: "FRAME" }),
    markReconnecting: () => send({ type: "RECONNECTING" }),
    markWarning: (error) => send({ type: "WARN", error }),

    armDeadline: (ms, onTimeout) => {
      deadline = setTimeout(() => {
        deadline = null;
        if (active() && !streamed) onTimeout();
      }, ms);
    },

    onCleanup: (fn) => {
      cleanups.push(fn);
    },

    cleanup: () => {
      cancelled = true;
      clearDeadline();
      forgetStreamed(id);
      cleanups.forEach((fn) => {
        try {
          fn();
        } catch {
          // Player may already be torn down.
        }
      });
      release();
    }
  };
};

import type { PlayerStatus } from "@/render/types/genetec";

export interface PlayerState {
  status: PlayerStatus;
  /**
   * In "error" status: the cause. While "playing": the last non-fatal player
   * error (informational), or null.
   */
  error: Error | null;
}

export type PlayerAction =
  | { type: "RESET" }
  | { type: "START" }
  | { type: "PLAYING" }
  | { type: "FRAME" }
  | { type: "RECONNECTING" }
  | { type: "WARN"; error: Error }
  | { type: "FAIL"; error: Error };

const IDLE: PlayerState = { status: "idle", error: null };
const LOADING: PlayerState = { status: "loading", error: null };
const PLAYING: PlayerState = { status: "playing", error: null };

export const initialPlayerState = (hasCamera: boolean): PlayerState =>
  hasCamera ? LOADING : IDLE;

/** Returns the previous reference when nothing changes, so React skips the render. */
export const playerReducer = (
  state: PlayerState,
  action: PlayerAction
): PlayerState => {
  switch (action.type) {
    case "RESET":
      return state.status === "idle" && !state.error ? state : IDLE;
    case "START":
      return state.status === "loading" && !state.error ? state : LOADING;
    case "PLAYING":
      return state.status === "playing" && !state.error ? state : PLAYING;
    case "FRAME":
      return state.status === "loading" ? PLAYING : state;
    case "RECONNECTING":
      return state.status === "loading" ? state : { ...state, status: "loading" };
    case "WARN":
      return { ...state, error: action.error };
    case "FAIL":
      return { status: "error", error: action.error };
  }
};

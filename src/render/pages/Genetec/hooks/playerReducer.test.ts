import {
  initialPlayerState,
  playerReducer,
  type PlayerState
} from "@/render/pages/Genetec/hooks/playerReducer";

const loading: PlayerState = { status: "loading", error: null };
const playing: PlayerState = { status: "playing", error: null };
const boom = new Error("boom");

describe("playerReducer", () => {
  it("starts idle without a camera and loading with one", () => {
    expect(initialPlayerState(false)).toEqual({ status: "idle", error: null });
    expect(initialPlayerState(true)).toEqual(loading);
  });

  it("START resets to loading (same reference when already loading)", () => {
    expect(playerReducer(loading, { type: "START" })).toBe(loading);
    expect(playerReducer({ status: "error", error: boom }, { type: "START" })).toEqual(
      loading
    );
  });

  it("RESET goes idle, keeping the reference when already idle", () => {
    const idle = initialPlayerState(false);
    expect(playerReducer(idle, { type: "RESET" })).toBe(idle);
    expect(playerReducer(playing, { type: "RESET" })).toEqual(idle);
  });

  it("PLAYING clears a non-fatal error but keeps a clean playing reference", () => {
    expect(playerReducer(playing, { type: "PLAYING" })).toBe(playing);
    expect(
      playerReducer({ status: "playing", error: boom }, { type: "PLAYING" })
    ).toEqual(playing);
    expect(playerReducer(loading, { type: "PLAYING" })).toEqual(playing);
  });

  it("FRAME only promotes loading to playing", () => {
    expect(playerReducer(loading, { type: "FRAME" })).toEqual(playing);
    const failed: PlayerState = { status: "error", error: boom };
    expect(playerReducer(failed, { type: "FRAME" })).toBe(failed);
    expect(playerReducer(playing, { type: "FRAME" })).toBe(playing);
  });

  it("RECONNECTING moves playing back to loading and keeps loading as is", () => {
    expect(playerReducer(playing, { type: "RECONNECTING" })).toEqual(loading);
    expect(playerReducer(loading, { type: "RECONNECTING" })).toBe(loading);
  });

  it("WARN exposes a non-fatal error without changing status", () => {
    expect(playerReducer(playing, { type: "WARN", error: boom })).toEqual({
      status: "playing",
      error: boom
    });
  });

  it("FAIL ends in error with the cause", () => {
    expect(playerReducer(playing, { type: "FAIL", error: boom })).toEqual({
      status: "error",
      error: boom
    });
  });
});

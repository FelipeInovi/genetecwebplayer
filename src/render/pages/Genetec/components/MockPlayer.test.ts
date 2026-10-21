import { createMockPlayer } from "@/render/pages/Genetec/components/MockPlayer";

describe("createMockPlayer", () => {
  it("produces plausible fake stats", async () => {
    const container = document.createElement("div");
    const player = createMockPlayer(container, "Cam");
    const stats = await player.getPlayerStats();
    expect(stats.fps).toBeGreaterThan(20);
    expect(stats.fps).toBeLessThanOrEqual(30);
    expect(stats.videoBitrateKbps).toBeGreaterThan(0);
    expect(stats.resolution).toEqual({ width: 640, height: 360 });
    expect(stats.videoCodec).toBe("H264");
    expect(stats.networkLatency).toEqual(expect.any(Number));
    expect(stats.firstFrameRenderDelay).toEqual(expect.any(Number));
    player.dispose();
  });

  it("counts cumulative packets and accepts the debug overlay flag", async () => {
    const container = document.createElement("div");
    const player = createMockPlayer(container, "Cam");
    player.showDebugOverlay(true);
    const a = await player.getPlayerStats();
    const b = await player.getPlayerStats();
    expect(b.packetsReceived as number).toBeGreaterThan(
      a.packetsReceived as number
    );
    player.dispose();
  });

  it("is started until stopped", () => {
    const player = createMockPlayer(document.createElement("div"), "Cam");
    expect(player.isStarted).toBe(true);
    player.stop();
    expect(player.isStarted).toBe(false);
    player.dispose();
  });
});

import type { IPlayerStats } from "@/render/types/genetec";

const FRAME_INTERVAL_MS = 1000;

export interface MockPlayerHandle {
  stop: () => void;
  dispose: () => void;
  readonly isStarted: boolean;
  /** Fake but plausible stats so metrics work in mock mode. */
  getPlayerStats: () => Promise<IPlayerStats>;
  showDebugOverlay: (show: boolean) => void;
}

const draw = (canvas: HTMLCanvasElement, cameraName: string) => {
  let ctx: CanvasRenderingContext2D | null = null;
  try {
    ctx = canvas.getContext("2d");
  } catch {
    ctx = null; // jsdom does not implement canvas
  }
  if (!ctx) return;
  const { width, height } = canvas;
  const bar = width / 7;
  const colors = [
    "#c0c0c0",
    "#c0c000",
    "#00c0c0",
    "#00c000",
    "#c000c0",
    "#c00000",
    "#0000c0"
  ];
  colors.forEach((color, i) => {
    ctx.fillStyle = color;
    ctx.fillRect(i * bar, 0, bar, height);
  });
  ctx.fillStyle = "rgba(0, 0, 0, 0.65)";
  ctx.fillRect(0, height * 0.35, width, height * 0.3);
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  ctx.font = `bold ${Math.max(12, Math.round(height / 9))}px monospace`;
  ctx.fillText(cameraName, width / 2, height * 0.47);
  ctx.fillText(new Date().toLocaleTimeString(), width / 2, height * 0.58);
  ctx.font = `${Math.max(10, Math.round(height / 14))}px monospace`;
  ctx.fillText("MOCK", width / 2, height * 0.9);
};

const jitter = (base: number, spread: number) =>
  base + (Math.random() - 0.5) * 2 * spread;

/** Canvas test pattern: no external video assets. Mimics the GWP player lifecycle. */
export const createMockPlayer = (
  container: HTMLElement,
  cameraName: string
): MockPlayerHandle => {
  const startedAt = Date.now();
  let started = true;
  let packets = 0;
  let overlayOn = false;
  const firstFrameDelay = Math.round(jitter(600, 200));
  const firstDataDelay = Math.round(jitter(250, 100));
  const canvas = document.createElement("canvas");
  canvas.width = 320;
  canvas.height = 180;
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  canvas.style.objectFit = "cover";
  container.appendChild(canvas);

  draw(canvas, cameraName);
  let timer: ReturnType<typeof setInterval> | null = setInterval(
    () => draw(canvas, cameraName),
    FRAME_INTERVAL_MS
  );

  const stop = () => {
    if (timer) clearInterval(timer);
    timer = null;
    started = false;
  };

  const getPlayerStats = async (): Promise<IPlayerStats> => {
    packets += Math.round(jitter(120, 20));
    return {
      id: cameraName,
      version: "mock",
      mode: "live",
      state: 2,
      speed: 1,
      streamStatus: "Streaming",
      lastErrorCode: null,
      lastErrorMessage: null,
      videoCodec: "H264",
      resolution: { width: 640, height: 360 },
      clockRate: 90000,
      fps: Math.min(30, Math.round(jitter(25, 4) * 10) / 10),
      kfInterval: null,
      videoBitrateKbps: Math.round(jitter(900, 150)),
      audioBitrateKbps: 0,
      isPrivacyProtected: false,
      playerStartTimestamp: startedAt,
      packetsReceived: packets,
      packetsLost: Math.floor(packets / 5000),
      framesDecoded: Math.round((Date.now() - startedAt) / 40),
      framesDropped: Math.floor((Date.now() - startedAt) / 60_000),
      networkLatency: Math.round(jitter(40, 15)),
      playerLatency: Math.round(jitter(12, 5)),
      firstDataReceivedDelay: firstDataDelay,
      firstDataReceivedTimestamp: startedAt + firstDataDelay,
      firstFrameRenderDelay: firstFrameDelay,
      firstFrameRenderTimestamp: startedAt + firstFrameDelay,
      lastFrameReceived: Date.now(),
      lastFrameRendered: Date.now(),
      mediaTime: Date.now(),
      zoomLevel: 1
    };
  };

  return {
    stop,
    get isStarted() {
      return started;
    },
    getPlayerStats,
    showDebugOverlay: (show: boolean) => {
      overlayOn = show;
      canvas.dataset.debug = String(overlayOn);
    },
    dispose: () => {
      stop();
      canvas.remove();
    }
  };
};

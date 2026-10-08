import { ReactNode, useRef } from "react";
import {
  act,
  render,
  renderHook as rtlRenderHook,
  waitFor,
  type RenderHookOptions
} from "@testing-library/react";
import poc from "@/render/config/poc.config";
import {
  GenetecServiceContext,
  GenetecServiceValue
} from "@/render/pages/Genetec/components/GenetecServiceContext";
import { GenetecTelemetryContext } from "@/render/pages/Genetec/components/GenetecTelemetryContext";
import { useGenetecPlayer } from "@/render/pages/Genetec/hooks/useGenetecPlayer";
import { useMediaGatewayService } from "@/render/pages/Genetec/hooks/useMediaGatewayService";
import {
  getEvents,
  getSamples
} from "@/render/pages/Genetec/stats/statsCollector";
import {
  resetStatsStore,
  useStatsStore
} from "@/render/pages/Genetec/stats/statsStore";
import { statsTelemetry } from "@/render/pages/Genetec/stats/statsTelemetry";
import { getGenetecToken } from "@/render/service/genetec/genetecService";
import { loadGwpScript } from "@/render/pages/Genetec/hooks/loadGwpScript";
import type {
  GenetecCamera,
  GenetecPlayerTelemetry
} from "@/render/types/genetec";

jest.mock("@/render/service/genetec/genetecService", () => ({
  getGenetecToken: jest.fn()
}));
jest.mock("@/render/pages/Genetec/hooks/loadGwpScript", () => ({
  loadGwpScript: jest.fn()
}));

const camera: GenetecCamera = {
  id: "cam-1",
  externalId: "guid-1",
  name: "Cam 1",
  provider: "genetec",
  status: "online",
  lat: 6.24,
  lng: -75.58,
  ptz: false
};

/** The stats module is the real telemetry in the harness: wire it like GenetecPage does. */
const renderHook = <Result, Props>(
  callback: (props: Props) => Result,
  options?: RenderHookOptions<Props>
) => {
  const Inner = options?.wrapper;
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <GenetecTelemetryContext.Provider value={statsTelemetry}>
      {Inner ? <Inner>{children}</Inner> : children}
    </GenetecTelemetryContext.Provider>
  );
  return rtlRenderHook(callback, { ...options, wrapper: Wrapper });
};

const makeRef = () => ({ current: document.createElement("div") });

describe("useGenetecPlayer (mock mode)", () => {
  beforeEach(() => {
    poc.genetecPlayerMode = "mock";
    jest.clearAllMocks();
    resetStatsStore();
  });

  it("is idle without a camera", () => {
    const ref = makeRef();
    const { result } = renderHook(() => useGenetecPlayer(ref, null));
    expect(result.current.status).toBe("idle");
  });

  it("goes loading -> playing and fetches no token", async () => {
    const ref = makeRef();
    const { result } = renderHook(() => useGenetecPlayer(ref, camera));
    expect(result.current.status).toBe("loading");
    await waitFor(() => expect(result.current.status).toBe("playing"));
    expect(getGenetecToken).not.toHaveBeenCalled();
  });

  it("goes to error for offline cameras", async () => {
    const ref = makeRef();
    const offline = { ...camera, status: "offline" as const };
    const { result } = renderHook(() => useGenetecPlayer(ref, offline));
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.error?.message).toMatch(/offline/i);
  });

  it("returns to idle when the camera is cleared", async () => {
    const ref = makeRef();
    const { result, rerender } = renderHook(
      ({ cam }: { cam: GenetecCamera | null }) => useGenetecPlayer(ref, cam),
      { initialProps: { cam: camera as GenetecCamera | null } }
    );
    await waitFor(() => expect(result.current.status).toBe("playing"));
    rerender({ cam: null });
    await waitFor(() => expect(result.current.status).toBe("idle"));
  });

  it("registers a stats getter that yields fake stats while playing", async () => {
    const ref = makeRef();
    const { result, unmount } = renderHook(() =>
      useGenetecPlayer(ref, camera)
    );
    await waitFor(() => expect(result.current.status).toBe("playing"));
    useStatsStore.getState().startPhase({ cameraCount: 4, multiplexed: false });
    await act(async () => {
      await useStatsStore.getState().pollOnce();
    });
    expect(getSamples()).toHaveLength(1);
    expect(getSamples()[0].cameraId).toBe("cam-1");
    unmount();
    await act(async () => {
      await useStatsStore.getState().pollOnce();
    });
    expect(getSamples()).toHaveLength(1);
    useStatsStore.getState().stopPhase();
  });
});

type Handler<T> = (payload: T) => void;
const makeEvent = <T,>() => {
  const handlers: Handler<T>[] = [];
  return {
    handlers,
    register: jest.fn((h: Handler<T>) => {
      handlers.push(h);
    }),
    unregister: jest.fn((h: Handler<T>) => {
      const i = handlers.indexOf(h);
      if (i >= 0) handlers.splice(i, 1);
    }),
    emit: (payload: T) => handlers.slice().forEach((h) => h(payload))
  };
};

const makePlayer = () => {
  const events = {
    onErrorStateRaised: makeEvent<{
      errorCode: number;
      value: string;
      isFatal: boolean;
    }>(),
    onStreamStatusChanged: makeEvent<{ state: number; value: string }>(),
    onPlayerStateChanged: makeEvent<{ playerState: number; value: string }>(),
    onFrameRendered: makeEvent<Date>()
  };
  const order: string[] = [];
  const player = {
    ...events,
    isStarted: true,
    start: jest.fn(async () => {
      order.push("start");
    }),
    startWithService: jest.fn(async () => {
      order.push("startWithService");
    }),
    playLive: jest.fn(),
    stop: jest.fn(),
    dispose: jest.fn(),
    showDebugOverlay: jest.fn(),
    getPlayerStats: jest.fn().mockResolvedValue({ fps: 25 })
  };
  // Track that handlers are registered before start.
  Object.values(events).forEach((e) =>
    e.register.mockImplementation((h: Handler<never>) => {
      order.push("register");
      (e.handlers as Handler<never>[]).push(h);
    })
  );
  return { player, events, order };
};

describe("useGenetecPlayer (gwp mode, individual)", () => {
  let ctx: ReturnType<typeof makePlayer>;
  const gwp = { buildPlayer: jest.fn() };

  beforeEach(() => {
    poc.genetecPlayerMode = "gwp";
    poc.mediaGatewayUrl = "https://mg.test";
    jest.clearAllMocks();
    resetStatsStore();
    ctx = makePlayer();
    gwp.buildPlayer.mockReturnValue(ctx.player);
    (loadGwpScript as jest.Mock).mockResolvedValue(gwp);
    (getGenetecToken as jest.Mock).mockResolvedValue({
      token: "tok",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      mediaGatewayUrl: "x"
    });
  });
  afterAll(() => {
    poc.genetecPlayerMode = "mock";
  });

  const mount = (cam: GenetecCamera = camera) => {
    const ref = makeRef();
    return { ref, ...renderHook(() => useGenetecPlayer(ref, cam)) };
  };

  it("registers handlers before start and starts with the /media endpoint", async () => {
    const { ref } = mount();
    await waitFor(() => expect(ctx.player.start).toHaveBeenCalled());
    expect(gwp.buildPlayer).toHaveBeenCalledWith(ref.current);
    expect(loadGwpScript).toHaveBeenCalledWith("https://mg.test");
    expect(ctx.order.indexOf("start")).toBeGreaterThan(
      ctx.order.lastIndexOf("register")
    );
    expect(ctx.order.filter((o) => o === "register")).toHaveLength(3);
    expect(ctx.player.start).toHaveBeenCalledWith(
      "guid-1",
      "https://mg.test/media",
      expect.any(Function)
    );
    expect(ctx.player.playLive).toHaveBeenCalled();
    const retriever = (ctx.player.start.mock.calls[0] as unknown[])[2] as (
      id: string
    ) => Promise<string>;
    await expect(retriever("guid-1")).resolves.toBe("tok");
    expect(getGenetecToken).toHaveBeenCalledWith("cam-1");
  });

  it("stays loading after start/playLive and plays only on Streaming", async () => {
    const { result } = mount();
    await waitFor(() => expect(ctx.player.playLive).toHaveBeenCalled());
    expect(result.current.status).toBe("loading");
    act(() =>
      ctx.events.onStreamStatusChanged.emit({ state: -1, value: "" })
    );
    expect(result.current.status).toBe("loading");
    act(() => ctx.events.onStreamStatusChanged.emit({ state: 5, value: "" }));
    expect(result.current.status).toBe("playing");
  });

  it("also plays on the first rendered frame", async () => {
    const { result } = mount();
    await waitFor(() => expect(ctx.player.playLive).toHaveBeenCalled());
    act(() => ctx.events.onFrameRendered.emit(new Date()));
    expect(result.current.status).toBe("playing");
  });

  it("goes back to loading while reconnecting", async () => {
    const { result } = mount();
    await waitFor(() => expect(ctx.player.playLive).toHaveBeenCalled());
    act(() => ctx.events.onStreamStatusChanged.emit({ state: 5, value: "" }));
    act(() =>
      ctx.events.onStreamStatusChanged.emit({ state: -1, value: "lost" })
    );
    expect(result.current.status).toBe("loading");
    act(() => ctx.events.onStreamStatusChanged.emit({ state: 5, value: "" }));
    expect(result.current.status).toBe("playing");
  });

  it.each([19, 22, 25, 31])(
    "treats stream status %i as non-recoverable: error state and stop()",
    async (code) => {
      const { result } = mount();
      await waitFor(() => expect(ctx.player.playLive).toHaveBeenCalled());
      act(() =>
        ctx.events.onStreamStatusChanged.emit({ state: code, value: "bad" })
      );
      expect(result.current.status).toBe("error");
      expect(result.current.error?.message).toContain("bad");
      expect(ctx.player.stop).toHaveBeenCalled();
      // A later frame must not resurrect the player.
      act(() => ctx.events.onFrameRendered.emit(new Date()));
      expect(result.current.status).toBe("error");
    }
  );

  it("fatal post-start errors reach React state", async () => {
    const { result } = mount();
    await waitFor(() => expect(ctx.player.playLive).toHaveBeenCalled());
    act(() =>
      ctx.events.onErrorStateRaised.emit({
        errorCode: 4,
        value: "conn failed",
        isFatal: true
      })
    );
    expect(result.current.status).toBe("error");
    expect(result.current.error).toMatchObject({
      message: "conn failed",
      code: 4,
      isFatal: true
    });
  });

  it("non-fatal errors are exposed without leaving the playing state", async () => {
    const { result } = mount();
    await waitFor(() => expect(ctx.player.playLive).toHaveBeenCalled());
    act(() => ctx.events.onStreamStatusChanged.emit({ state: 5, value: "" }));
    act(() =>
      ctx.events.onErrorStateRaised.emit({
        errorCode: 9,
        value: "timeout",
        isFatal: false
      })
    );
    expect(result.current.status).toBe("playing");
    expect(result.current.error).toMatchObject({ code: 9, isFatal: false });
  });

  it("logs errors and stream statuses into the active phase", async () => {
    useStatsStore.getState().startPhase({ cameraCount: 4, multiplexed: false });
    mount();
    await waitFor(() => expect(ctx.player.playLive).toHaveBeenCalled());
    act(() => ctx.events.onStreamStatusChanged.emit({ state: 5, value: "" }));
    act(() =>
      ctx.events.onErrorStateRaised.emit({
        errorCode: 9,
        value: "timeout",
        isFatal: false
      })
    );
    const events = getEvents();
    expect(events.map((e) => [e.kind, e.code, e.cameraId])).toEqual([
      ["start-requested", 0, "cam-1"],
      ["streamStatus", 5, "cam-1"],
      ["error", 9, "cam-1"]
    ]);
    useStatsStore.getState().stopPhase();
  });

  it("exposes the player for stats polling and applies the debug overlay flag", async () => {
    useStatsStore.getState().startPhase({ cameraCount: 4, multiplexed: false });
    let debugOverlay = false;
    const Wrapper = ({ children }: { children: ReactNode }) => (
      <GenetecServiceContext.Provider
        value={{
          multiplexed: false,
          service: null,
          ready: true,
          error: null,
          debugOverlay
        }}
      >
        {children}
      </GenetecServiceContext.Provider>
    );
    const ref = makeRef();
    const { rerender } = renderHook(() => useGenetecPlayer(ref, camera), {
      wrapper: Wrapper
    });
    await waitFor(() => expect(ctx.player.playLive).toHaveBeenCalled());
    await act(async () => {
      await useStatsStore.getState().pollOnce();
    });
    expect(ctx.player.getPlayerStats).toHaveBeenCalled();
    expect(getSamples()[0].fps).toBe(25);
    expect(ctx.player.showDebugOverlay).not.toHaveBeenCalled();
    debugOverlay = true;
    rerender();
    expect(ctx.player.showDebugOverlay).toHaveBeenCalledWith(true);
    useStatsStore.getState().stopPhase();
  });

  it("surfaces start failures as error status", async () => {
    ctx.player.start.mockRejectedValue(new Error("boom"));
    const { result } = mount();
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.error?.message).toBe("boom");
  });

  it("unregisters handlers, stops and disposes on unmount", async () => {
    const { unmount } = mount();
    await waitFor(() => expect(ctx.player.playLive).toHaveBeenCalled());
    unmount();
    expect(ctx.events.onErrorStateRaised.unregister).toHaveBeenCalledTimes(1);
    expect(ctx.events.onStreamStatusChanged.unregister).toHaveBeenCalledTimes(1);
    expect(ctx.events.onFrameRendered.unregister).toHaveBeenCalledTimes(1);
    expect(ctx.events.onErrorStateRaised.handlers).toHaveLength(0);
    expect(ctx.player.stop).toHaveBeenCalled();
    expect(ctx.player.dispose).toHaveBeenCalled();
  });

  it("does not restart when only the camera object identity changes", async () => {
    const ref = makeRef();
    const { rerender } = renderHook(
      ({ cam }: { cam: GenetecCamera }) => useGenetecPlayer(ref, cam),
      { initialProps: { cam: camera } }
    );
    await waitFor(() => expect(ctx.player.playLive).toHaveBeenCalled());
    rerender({ cam: { ...camera } });
    await act(async () => undefined);
    expect(gwp.buildPlayer).toHaveBeenCalledTimes(1);
    expect(ctx.player.dispose).not.toHaveBeenCalled();
  });

  it("does not build a player if unmounted while the script loads", async () => {
    let resolveLoad!: (g: unknown) => void;
    (loadGwpScript as jest.Mock).mockReturnValue(
      new Promise((r) => (resolveLoad = r))
    );
    const { unmount } = mount();
    unmount();
    await act(async () => resolveLoad(gwp));
    expect(gwp.buildPlayer).not.toHaveBeenCalled();
  });
});

describe("useGenetecPlayer (gwp mode, multiplexed)", () => {
  const gwp = { buildPlayer: jest.fn() };
  const service = { dispose: jest.fn() };
  let ctx: ReturnType<typeof makePlayer>;

  const wrapperFor = (value: GenetecServiceValue) => {
    const Wrapper = ({ children }: { children: ReactNode }) => (
      <GenetecServiceContext.Provider value={value}>
        {children}
      </GenetecServiceContext.Provider>
    );
    return Wrapper;
  };

  beforeEach(() => {
    poc.genetecPlayerMode = "gwp";
    poc.mediaGatewayUrl = "https://mg.test";
    jest.clearAllMocks();
    resetStatsStore();
    ctx = makePlayer();
    gwp.buildPlayer.mockReturnValue(ctx.player);
    (loadGwpScript as jest.Mock).mockResolvedValue(gwp);
  });
  afterAll(() => {
    poc.genetecPlayerMode = "mock";
  });

  it("uses startWithService with the shared service and never start()", async () => {
    const ref = makeRef();
    const { result } = renderHook(() => useGenetecPlayer(ref, camera), {
      wrapper: wrapperFor({
        multiplexed: true,
        service,
        ready: true,
        error: null
      })
    });
    await waitFor(() => expect(ctx.player.playLive).toHaveBeenCalled());
    expect(ctx.player.startWithService).toHaveBeenCalledWith("guid-1", service);
    expect(ctx.player.start).not.toHaveBeenCalled();
    act(() => ctx.events.onStreamStatusChanged.emit({ state: 5, value: "" }));
    expect(result.current.status).toBe("playing");
  });

  it("waits for the shared service before building a player", async () => {
    const ref = makeRef();
    const { result } = renderHook(() => useGenetecPlayer(ref, camera), {
      wrapper: wrapperFor({
        multiplexed: true,
        service: null,
        ready: false,
        error: null
      })
    });
    await act(async () => undefined);
    expect(gwp.buildPlayer).not.toHaveBeenCalled();
    expect(result.current.status).toBe("loading");
  });

  it("surfaces a service build error", async () => {
    const ref = makeRef();
    const { result } = renderHook(() => useGenetecPlayer(ref, camera), {
      wrapper: wrapperFor({
        multiplexed: true,
        service: null,
        ready: true,
        error: new Error("svc down")
      })
    });
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.error?.message).toBe("svc down");
    expect(gwp.buildPlayer).not.toHaveBeenCalled();
  });
});

describe("useGenetecPlayer (gwp mode, review fixes)", () => {
  const gwp = { buildPlayer: jest.fn() };
  let ctx: ReturnType<typeof makePlayer>;
  const events = () => getEvents();
  const errorsBy = (source: string) =>
    events().filter((e) => e.kind === "error" && e.source === source);

  const retrieverOf = (c: ReturnType<typeof makePlayer>) =>
    (c.player.start.mock.calls[0] as unknown[])[2] as (
      id: string
    ) => Promise<string>;

  beforeEach(() => {
    poc.genetecPlayerMode = "gwp";
    poc.mediaGatewayUrl = "https://mg.test";
    poc.startTimeoutMs = 30_000;
    jest.clearAllMocks();
    resetStatsStore();
    ctx = makePlayer();
    gwp.buildPlayer.mockReset();
    gwp.buildPlayer.mockReturnValue(ctx.player);
    (loadGwpScript as jest.Mock).mockReset();
    (loadGwpScript as jest.Mock).mockResolvedValue(gwp);
    (getGenetecToken as jest.Mock).mockReset();
    (getGenetecToken as jest.Mock).mockResolvedValue({
      token: "tok",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      mediaGatewayUrl: "x"
    });
    useStatsStore.getState().startPhase({ cameraCount: 4, multiplexed: false });
  });
  afterEach(() => {
    useStatsStore.getState().stopPhase();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });
  afterAll(() => {
    poc.genetecPlayerMode = "mock";
  });

  const mount = (cam: GenetecCamera = camera) => {
    const ref = makeRef();
    return { ref, ...renderHook(() => useGenetecPlayer(ref, cam)) };
  };

  it("B1: records a start-requested event per cell", async () => {
    mount();
    await waitFor(() => expect(ctx.player.playLive).toHaveBeenCalled());
    expect(events().filter((e) => e.kind === "start-requested")).toHaveLength(1);
  });

  it("B1: records a script-load failure", async () => {
    (loadGwpScript as jest.Mock).mockRejectedValue(new Error("script down"));
    const { result } = mount();
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(errorsBy("script-load")).toHaveLength(1);
    expect(errorsBy("script-load")[0]).toMatchObject({
      cameraId: "cam-1",
      message: "script down"
    });
  });

  it("B1: records a token failure before the first Streaming exactly once", async () => {
    (getGenetecToken as jest.Mock).mockRejectedValue(new Error("tok down"));
    ctx.player.start.mockImplementation(async (...args: unknown[]) => {
      await (args[2] as (g: string) => Promise<string>)("guid-1");
    });
    const { result } = mount();
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(errorsBy("token")).toHaveLength(1);
    expect(errorsBy("start")).toHaveLength(0);
  });

  it("B1: records a start failure", async () => {
    ctx.player.start.mockRejectedValue(new Error("boom"));
    const { result } = mount();
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(errorsBy("start")).toHaveLength(1);
  });

  it("B1: records an offline camera", async () => {
    const { result } = mount({ ...camera, status: "offline" });
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(errorsBy("offline")).toHaveLength(1);
    expect(loadGwpScript).not.toHaveBeenCalled();
  });

  it("B1: records a fatal stream status once", async () => {
    const { result } = mount();
    await waitFor(() => expect(ctx.player.playLive).toHaveBeenCalled());
    act(() =>
      ctx.events.onStreamStatusChanged.emit({ state: 22, value: "unreachable" })
    );
    expect(result.current.status).toBe("error");
    expect(errorsBy("fatal-status")).toHaveLength(1);
  });

  it("B1: records a service build failure", async () => {
    const ref = makeRef();
    const Wrapper = ({ children }: { children: ReactNode }) => (
      <GenetecServiceContext.Provider
        value={{
          multiplexed: true,
          service: null,
          ready: true,
          error: new Error("svc down")
        }}
      >
        {children}
      </GenetecServiceContext.Provider>
    );
    renderHook(() => useGenetecPlayer(ref, camera), { wrapper: Wrapper });
    await waitFor(() => expect(errorsBy("service-build")).toHaveLength(1));
  });

  describe("C1 start deadline", () => {
    beforeEach(() => {
      jest.useFakeTimers();
      poc.startTimeoutMs = 5_000;
    });

    it("fails with start-timeout, records it and disposes the player", async () => {
      const { result } = mount();
      await act(async () => {
        await jest.advanceTimersByTimeAsync(4_999);
      });
      expect(result.current.status).toBe("loading");
      await act(async () => {
        await jest.advanceTimersByTimeAsync(1);
      });
      expect(result.current.status).toBe("error");
      expect(errorsBy("start-timeout")).toHaveLength(1);
      expect(ctx.player.stop).toHaveBeenCalled();
      expect(ctx.player.dispose).toHaveBeenCalledTimes(1);
    });

    it("does not fire once the stream reached Streaming", async () => {
      const { result } = mount();
      await act(async () => {
        await jest.advanceTimersByTimeAsync(100);
      });
      act(() => ctx.events.onStreamStatusChanged.emit({ state: 5, value: "" }));
      await act(async () => {
        await jest.advanceTimersByTimeAsync(60_000);
      });
      expect(result.current.status).toBe("playing");
      expect(errorsBy("start-timeout")).toHaveLength(0);
    });

    it("is cancelled on unmount", async () => {
      const { unmount } = mount();
      await act(async () => {
        await jest.advanceTimersByTimeAsync(100);
      });
      unmount();
      await act(async () => {
        await jest.advanceTimersByTimeAsync(60_000);
      });
      expect(errorsBy("start-timeout")).toHaveLength(0);
    });
  });

  describe("C5 token renewal", () => {
    it("records a renewal failure after Streaming, rethrows it, and keeps playing", async () => {
      const { result } = mount();
      await waitFor(() => expect(ctx.player.playLive).toHaveBeenCalled());
      act(() => ctx.events.onStreamStatusChanged.emit({ state: 5, value: "" }));
      (getGenetecToken as jest.Mock).mockRejectedValue(new Error("renew down"));
      const retrieve = retrieverOf(ctx);
      // Expire the cached token so GWP asks the backend again.
      const realNow = Date.now();
      jest.spyOn(Date, "now").mockReturnValue(realNow + 120_000);
      await expect(retrieve("guid-1")).rejects.toThrow("renew down");
      expect(result.current.status).toBe("playing");
      expect(errorsBy("token-renewal")).toHaveLength(1);
      expect(errorsBy("token")).toHaveLength(0);
    });
  });

  describe("C7 lifecycle", () => {
    it("tears down the old player when the camera id changes and starts the new one", async () => {
      const ctx2 = makePlayer();
      gwp.buildPlayer.mockReset();
      gwp.buildPlayer
        .mockReturnValueOnce(ctx.player)
        .mockReturnValueOnce(ctx2.player);
      const ref = makeRef();
      const cam2 = { ...camera, id: "cam-2", externalId: "guid-2", name: "Cam 2" };
      const { rerender } = renderHook(
        ({ cam }: { cam: GenetecCamera }) => useGenetecPlayer(ref, cam),
        { initialProps: { cam: camera } }
      );
      await waitFor(() => expect(ctx.player.playLive).toHaveBeenCalled());
      rerender({ cam: cam2 });
      await waitFor(() => expect(ctx2.player.playLive).toHaveBeenCalled());
      expect(ctx.events.onStreamStatusChanged.handlers).toHaveLength(0);
      expect(ctx.events.onErrorStateRaised.handlers).toHaveLength(0);
      expect(ctx.events.onFrameRendered.handlers).toHaveLength(0);
      expect(ctx.player.stop).toHaveBeenCalled();
      expect(ctx.player.dispose).toHaveBeenCalled();
      expect(ctx2.player.start).toHaveBeenCalledWith(
        "guid-2",
        "https://mg.test/media",
        expect.any(Function)
      );
      await act(async () => {
        await useStatsStore.getState().pollOnce();
      });
      expect(getSamples().map((x) => x.cameraId)).toEqual(["cam-2"]);
      expect(ctx.player.getPlayerStats).not.toHaveBeenCalled();
    });

    it("releases the old session (stop, dispose) BEFORE the new camera starts", async () => {
      const ctx2 = makePlayer();
      gwp.buildPlayer.mockReset();
      gwp.buildPlayer
        .mockReturnValueOnce(ctx.player)
        .mockReturnValueOnce(ctx2.player);
      const ref = makeRef();
      const cam2 = { ...camera, id: "cam-2", externalId: "guid-2", name: "Cam 2" };
      const { rerender } = renderHook(
        ({ cam }: { cam: GenetecCamera }) => useGenetecPlayer(ref, cam),
        { initialProps: { cam: camera } }
      );
      await waitFor(() => expect(ctx.player.playLive).toHaveBeenCalled());
      rerender({ cam: cam2 });
      await waitFor(() => expect(ctx2.player.start).toHaveBeenCalled());
      const stopOrder = ctx.player.stop.mock.invocationCallOrder[0];
      const disposeOrder = ctx.player.dispose.mock.invocationCallOrder[0];
      const buildOrder = gwp.buildPlayer.mock.invocationCallOrder[1];
      const startOrder = ctx2.player.start.mock.invocationCallOrder[0];
      expect(stopOrder).toBeLessThan(disposeOrder);
      expect(disposeOrder).toBeLessThan(buildOrder);
      expect(disposeOrder).toBeLessThan(startOrder);
    });

    it("ignores stale events from a player after cleanup", async () => {
      const { result, unmount } = mount();
      await waitFor(() => expect(ctx.player.playLive).toHaveBeenCalled());
      const stale = {
        status: ctx.events.onStreamStatusChanged.handlers[0],
        error: ctx.events.onErrorStateRaised.handlers[0],
        frame: ctx.events.onFrameRendered.handlers[0]
      };
      unmount();
      const before = events().length;
      const stateBefore = result.current;
      act(() => {
        stale.status({ state: 5, value: "" });
        stale.status({ state: 22, value: "late" });
        stale.error({ errorCode: 1, value: "late", isFatal: true });
        stale.frame(new Date());
      });
      expect(events()).toHaveLength(before);
      expect(result.current).toBe(stateBefore);
    });

    it("fails in gwp mode for an offline camera without loading the script", async () => {
      const { result } = mount({ ...camera, status: "offline" });
      await waitFor(() => expect(result.current.status).toBe("error"));
      expect(result.current.error?.message).toMatch(/offline/i);
      expect(gwp.buildPlayer).not.toHaveBeenCalled();
    });

    it("does not play or leak when cancelled between buildPlayer and start resolving", async () => {
      let resolveStart!: () => void;
      ctx.player.start.mockImplementation(
        () => new Promise<void>((r) => (resolveStart = r))
      );
      const { unmount } = mount();
      await waitFor(() => expect(ctx.player.start).toHaveBeenCalled());
      unmount();
      await act(async () => resolveStart());
      expect(ctx.player.playLive).not.toHaveBeenCalled();
      expect(ctx.player.stop).toHaveBeenCalledTimes(1);
      expect(ctx.player.dispose).toHaveBeenCalledTimes(1);
      expect(ctx.events.onStreamStatusChanged.handlers).toHaveLength(0);
    });
  });
});

describe("useGenetecPlayer (gwp mode, batch 2 review fixes)", () => {
  const gwp = { buildPlayer: jest.fn() };
  let ctx: ReturnType<typeof makePlayer>;

  beforeEach(() => {
    poc.genetecPlayerMode = "gwp";
    poc.mediaGatewayUrl = "https://mg.test";
    poc.startTimeoutMs = 30_000;
    jest.clearAllMocks();
    resetStatsStore();
    ctx = makePlayer();
    gwp.buildPlayer.mockReset();
    gwp.buildPlayer.mockReturnValue(ctx.player);
    (loadGwpScript as jest.Mock).mockReset();
    (loadGwpScript as jest.Mock).mockResolvedValue(gwp);
    (getGenetecToken as jest.Mock).mockReset();
    (getGenetecToken as jest.Mock).mockResolvedValue({
      token: "tok",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      mediaGatewayUrl: "x"
    });
    useStatsStore.getState().startPhase({ cameraCount: 4, multiplexed: false });
  });
  afterEach(() => {
    useStatsStore.getState().stopPhase();
    jest.useRealTimers();
  });
  afterAll(() => {
    poc.genetecPlayerMode = "mock";
  });

  const mount = () => {
    const ref = makeRef();
    return renderHook(() => useGenetecPlayer(ref, camera));
  };
  const pollNoStatsExpected = async () => {
    await act(async () => {
      await useStatsStore.getState().pollOnce();
    });
    expect(ctx.player.getPlayerStats).not.toHaveBeenCalled();
  };

  it("never builds a player when the start deadline fires during script load", async () => {
    jest.useFakeTimers();
    poc.startTimeoutMs = 5_000;
    let resolveScript!: (g: typeof gwp) => void;
    (loadGwpScript as jest.Mock).mockReturnValue(
      new Promise((r) => (resolveScript = r))
    );
    const { result } = mount();
    await act(async () => {
      await jest.advanceTimersByTimeAsync(5_000);
    });
    expect(result.current.status).toBe("error");
    await act(async () => resolveScript(gwp));
    expect(gwp.buildPlayer).not.toHaveBeenCalled();
  });

  it("releases the player and stops polling after a start failure, once, even on unmount", async () => {
    ctx.player.start.mockRejectedValue(new Error("boom"));
    const { result, unmount } = mount();
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(ctx.player.stop).toHaveBeenCalledTimes(1);
    expect(ctx.player.dispose).toHaveBeenCalledTimes(1);
    await pollNoStatsExpected();
    unmount();
    expect(ctx.player.stop).toHaveBeenCalledTimes(1);
    expect(ctx.player.dispose).toHaveBeenCalledTimes(1);
  });

  it("releases the player and stops polling after a fatal gwp error, once, even on unmount", async () => {
    const { result, unmount } = mount();
    await waitFor(() => expect(ctx.player.playLive).toHaveBeenCalled());
    act(() =>
      ctx.events.onErrorStateRaised.emit({ errorCode: 9, value: "fatal", isFatal: true })
    );
    expect(result.current.status).toBe("error");
    expect(ctx.player.stop).toHaveBeenCalledTimes(1);
    expect(ctx.player.dispose).toHaveBeenCalledTimes(1);
    await pollNoStatsExpected();
    unmount();
    expect(ctx.player.stop).toHaveBeenCalledTimes(1);
    expect(ctx.player.dispose).toHaveBeenCalledTimes(1);
  });

  it("releases the player once after a fatal stream status", async () => {
    const { result } = mount();
    await waitFor(() => expect(ctx.player.playLive).toHaveBeenCalled());
    act(() =>
      ctx.events.onStreamStatusChanged.emit({ state: 22, value: "unreachable" })
    );
    expect(result.current.status).toBe("error");
    expect(ctx.player.stop).toHaveBeenCalledTimes(1);
    expect(ctx.player.dispose).toHaveBeenCalledTimes(1);
  });

  it("shares one token concurrency cap across 8 cells in individual mode", async () => {
    let active = 0;
    let maxActive = 0;
    const releases: Array<() => void> = [];
    (getGenetecToken as jest.Mock).mockImplementation(
      () =>
        new Promise((resolve) => {
          active += 1;
          maxActive = Math.max(maxActive, active);
          releases.push(() => {
            active -= 1;
            resolve({
              token: "tok",
              expiresAt: new Date(Date.now() + 60_000).toISOString(),
              mediaGatewayUrl: "x"
            });
          });
        })
    );
    gwp.buildPlayer.mockImplementation(() => {
      const c = makePlayer();
      c.player.start.mockImplementation(async (...args: unknown[]) => {
        await (args[2] as (g: string) => Promise<string>)(args[0] as string);
      });
      return c.player;
    });
    const cams: GenetecCamera[] = Array.from({ length: 8 }, (_, i) => ({
      ...camera,
      id: `cam-${i}`,
      externalId: `guid-${i}`,
      name: `Cam ${i}`
    }));
    const Cell = ({ cam }: { cam: GenetecCamera }) => {
      const ref = useRef(document.createElement("div"));
      useGenetecPlayer(ref, cam);
      return null;
    };
    const Mosaic = () => {
      const value = useMediaGatewayService(false, cams);
      return (
        <GenetecServiceContext.Provider value={value}>
          {cams.map((c) => (
            <Cell key={c.id} cam={c} />
          ))}
        </GenetecServiceContext.Provider>
      );
    };
    render(<Mosaic />);
    await waitFor(() => expect(releases.length).toBeGreaterThanOrEqual(4));
    await act(async () => {
      await Promise.resolve();
    });
    expect(maxActive).toBe(4);
    // Drain: every released slot lets the next queued fetch start.
    for (let i = 0; i < 8; i += 1) {
      await waitFor(() => expect(releases.length).toBeGreaterThan(i));
      await act(async () => releases[i]());
    }
    expect(getGenetecToken).toHaveBeenCalledTimes(8);
    expect(maxActive).toBeLessThanOrEqual(4);
  });
});

describe("useGenetecPlayer telemetry seam", () => {
  const gwp = { buildPlayer: jest.fn() };
  let ctx: ReturnType<typeof makePlayer>;

  const fakeTelemetry = () => {
    const off = jest.fn();
    const telemetry: GenetecPlayerTelemetry = {
      onStartRequested: jest.fn(),
      onError: jest.fn(),
      onStreamStatus: jest.fn(),
      registerStatsSource: jest.fn(() => off)
    };
    const wrapper = ({ children }: { children: ReactNode }) => (
      <GenetecTelemetryContext.Provider value={telemetry}>
        {children}
      </GenetecTelemetryContext.Provider>
    );
    return { telemetry, off, wrapper };
  };

  beforeEach(() => {
    poc.genetecPlayerMode = "gwp";
    poc.mediaGatewayUrl = "https://mg.test";
    poc.startTimeoutMs = 30_000;
    jest.clearAllMocks();
    ctx = makePlayer();
    gwp.buildPlayer.mockReset();
    gwp.buildPlayer.mockReturnValue(ctx.player);
    (loadGwpScript as jest.Mock).mockReset();
    (loadGwpScript as jest.Mock).mockResolvedValue(gwp);
    (getGenetecToken as jest.Mock).mockReset();
    (getGenetecToken as jest.Mock).mockResolvedValue({
      token: "tok",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      mediaGatewayUrl: "x"
    });
  });
  afterAll(() => {
    poc.genetecPlayerMode = "mock";
  });

  it("plays, fails and releases with no provider (no-op telemetry)", async () => {
    const ref = makeRef();
    const { result, unmount } = rtlRenderHook(() =>
      useGenetecPlayer(ref, camera)
    );
    await waitFor(() => expect(ctx.player.playLive).toHaveBeenCalled());
    act(() => ctx.events.onStreamStatusChanged.emit({ state: 5, value: "" }));
    expect(result.current.status).toBe("playing");
    act(() =>
      ctx.events.onErrorStateRaised.emit({
        errorCode: 9,
        value: "late",
        isFatal: true
      })
    );
    expect(result.current.status).toBe("error");
    unmount();
    expect(ctx.player.dispose).toHaveBeenCalledTimes(1);
  });

  it("reports start, status, errors and the stats source to a provided telemetry", async () => {
    const { telemetry, off, wrapper } = fakeTelemetry();
    const ref = makeRef();
    const { unmount } = rtlRenderHook(() => useGenetecPlayer(ref, camera), {
      wrapper
    });
    await waitFor(() => expect(ctx.player.playLive).toHaveBeenCalled());
    expect(telemetry.onStartRequested).toHaveBeenCalledWith("cam-1");
    expect(telemetry.registerStatsSource).toHaveBeenCalledWith(
      "cam-1",
      expect.any(Function)
    );
    act(() => ctx.events.onStreamStatusChanged.emit({ state: 5, value: "ok" }));
    expect(telemetry.onStreamStatus).toHaveBeenCalledWith("cam-1", 5, "ok");
    act(() =>
      ctx.events.onErrorStateRaised.emit({
        errorCode: 9,
        value: "timeout",
        isFatal: false
      })
    );
    expect(telemetry.onError).toHaveBeenCalledWith("cam-1", {
      code: 9,
      isFatal: false,
      message: "timeout",
      source: "gwp-error"
    });
    expect(off).not.toHaveBeenCalled();
    unmount();
    expect(off).toHaveBeenCalledTimes(1);
  });

  it("reports a fatal start failure exactly once", async () => {
    const { telemetry, wrapper } = fakeTelemetry();
    ctx.player.start.mockRejectedValue(new Error("boom"));
    const ref = makeRef();
    const { result } = rtlRenderHook(() => useGenetecPlayer(ref, camera), {
      wrapper
    });
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(telemetry.onError).toHaveBeenCalledTimes(1);
    expect(telemetry.onError).toHaveBeenCalledWith("cam-1", {
      code: 0,
      isFatal: true,
      message: "boom",
      source: "start"
    });
  });

  it("reports the mock player as Streaming", async () => {
    poc.genetecPlayerMode = "mock";
    const { telemetry, wrapper } = fakeTelemetry();
    const ref = makeRef();
    const { result } = rtlRenderHook(() => useGenetecPlayer(ref, camera), {
      wrapper
    });
    await waitFor(() => expect(result.current.status).toBe("playing"));
    expect(telemetry.onStreamStatus).toHaveBeenCalledWith("cam-1", 5, "mock");
    expect(telemetry.registerStatsSource).toHaveBeenCalledTimes(1);
  });
});

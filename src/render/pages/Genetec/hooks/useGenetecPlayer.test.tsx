import { ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import poc from "@/render/config/poc.config";
import {
  GenetecServiceContext,
  GenetecServiceValue
} from "@/render/pages/Genetec/components/GenetecServiceContext";
import { useGenetecPlayer } from "@/render/pages/Genetec/hooks/useGenetecPlayer";
import {
  resetStatsStore,
  useStatsStore
} from "@/render/pages/Genetec/stats/statsStore";
import { getGenetecToken } from "@/render/service/genetec/genetecService";
import { loadGwpScript } from "@/render/pages/Genetec/hooks/loadGwpScript";
import type { GenetecCamera } from "@/render/types/genetec";

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
    useStatsStore.getState().startPhase();
    await act(async () => {
      await useStatsStore.getState().pollOnce();
    });
    expect(useStatsStore.getState().samples).toHaveLength(1);
    expect(useStatsStore.getState().samples[0].cameraId).toBe("cam-1");
    unmount();
    await act(async () => {
      await useStatsStore.getState().pollOnce();
    });
    expect(useStatsStore.getState().samples).toHaveLength(1);
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
    useStatsStore.getState().startPhase();
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
    const events = useStatsStore.getState().events;
    expect(events.map((e) => [e.kind, e.code, e.cameraId])).toEqual([
      ["streamStatus", 5, "cam-1"],
      ["error", 9, "cam-1"]
    ]);
    useStatsStore.getState().stopPhase();
  });

  it("exposes the player for stats polling and applies the debug overlay flag", async () => {
    useStatsStore.getState().startPhase();
    mount();
    await waitFor(() => expect(ctx.player.playLive).toHaveBeenCalled());
    await act(async () => {
      await useStatsStore.getState().pollOnce();
    });
    expect(ctx.player.getPlayerStats).toHaveBeenCalled();
    expect(useStatsStore.getState().samples[0].fps).toBe(25);
    act(() => useStatsStore.getState().setDebugOverlay(true));
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

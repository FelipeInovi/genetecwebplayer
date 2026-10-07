import { ReactNode } from "react";
import {
  act,
  renderHook as rtlRenderHook,
  waitFor,
  type RenderHookOptions
} from "@testing-library/react";
import poc from "@/render/config/poc.config";
import { GenetecTelemetryContext } from "@/render/pages/Genetec/components/GenetecTelemetryContext";
import { loadGwpScript } from "@/render/pages/Genetec/hooks/loadGwpScript";
import {
  markStreamed,
  resetStreamed
} from "@/render/pages/Genetec/hooks/streamedCameras";
import { useMediaGatewayService } from "@/render/pages/Genetec/hooks/useMediaGatewayService";
import { getEvents } from "@/render/pages/Genetec/stats/statsCollector";
import {
  resetStatsStore,
  useStatsStore
} from "@/render/pages/Genetec/stats/statsStore";
import { statsTelemetry } from "@/render/pages/Genetec/stats/statsTelemetry";
import { getGenetecToken } from "@/render/service/genetec/genetecService";
import type { GenetecCamera } from "@/render/types/genetec";

jest.mock("@/render/service/genetec/genetecService", () => ({
  getGenetecToken: jest.fn()
}));
jest.mock("@/render/pages/Genetec/hooks/loadGwpScript", () => ({
  loadGwpScript: jest.fn()
}));

const renderHook = <Result, Props>(
  callback: (props: Props) => Result,
  options?: RenderHookOptions<Props>
) =>
  rtlRenderHook(callback, {
    ...options,
    wrapper: ({ children }: { children: ReactNode }) => (
      <GenetecTelemetryContext.Provider value={statsTelemetry}>
        {children}
      </GenetecTelemetryContext.Provider>
    )
  });

const cam = (n: number): GenetecCamera => ({
  id: `cam-${n}`,
  externalId: `guid-${n}`,
  name: `Cam ${n}`,
  provider: "genetec",
  status: "online",
  lat: null,
  lng: null,
  ptz: false
});
const cameras = [cam(1), cam(2)];

describe("useMediaGatewayService", () => {
  const service = { dispose: jest.fn() };
  const gwp = { buildMediaGatewayService: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
    poc.genetecPlayerMode = "gwp";
    poc.mediaGatewayUrl = "https://mg.test";
    gwp.buildMediaGatewayService.mockResolvedValue(service);
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

  it("is ready without a service in individual mode", () => {
    const { result } = renderHook(() =>
      useMediaGatewayService(false, cameras)
    );
    expect(result.current).toMatchObject({
      multiplexed: false,
      service: null,
      ready: true
    });
    expect(gwp.buildMediaGatewayService).not.toHaveBeenCalled();
  });

  it("builds one service with the /media endpoint and a GUID-aware token retriever", async () => {
    const { result } = renderHook(() => useMediaGatewayService(true, cameras));
    expect(result.current.ready).toBe(false);
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.service).toBe(service);
    expect(gwp.buildMediaGatewayService).toHaveBeenCalledTimes(1);
    expect(gwp.buildMediaGatewayService).toHaveBeenCalledWith(
      "https://mg.test/media",
      expect.any(Function)
    );
    const retriever = gwp.buildMediaGatewayService.mock.calls[0][1];
    await expect(retriever("guid-2")).resolves.toBe("tok");
    expect(getGenetecToken).toHaveBeenCalledWith("cam-2");
  });

  it("disposes the service on unmount", async () => {
    const { result, unmount } = renderHook(() =>
      useMediaGatewayService(true, cameras)
    );
    await waitFor(() => expect(result.current.ready).toBe(true));
    unmount();
    expect(service.dispose).toHaveBeenCalledTimes(1);
  });

  it("disposes the service when switching back to individual mode", async () => {
    const { result, rerender } = renderHook(
      ({ mux }: { mux: boolean }) => useMediaGatewayService(mux, cameras),
      { initialProps: { mux: true } }
    );
    await waitFor(() => expect(result.current.ready).toBe(true));
    rerender({ mux: false });
    expect(service.dispose).toHaveBeenCalledTimes(1);
    expect(result.current.service).toBeNull();
  });

  it("disposes a service that resolves after unmount", async () => {
    let resolveBuild!: (s: unknown) => void;
    gwp.buildMediaGatewayService.mockReturnValue(
      new Promise((r) => (resolveBuild = r))
    );
    const { unmount } = renderHook(() => useMediaGatewayService(true, cameras));
    await waitFor(() =>
      expect(gwp.buildMediaGatewayService).toHaveBeenCalled()
    );
    unmount();
    await act(async () => resolveBuild(service));
    expect(service.dispose).toHaveBeenCalledTimes(1);
  });

  it("surfaces build failures", async () => {
    gwp.buildMediaGatewayService.mockRejectedValue(new Error("nope"));
    const { result } = renderHook(() => useMediaGatewayService(true, cameras));
    await waitFor(() => expect(result.current.error?.message).toBe("nope"));
  });

  it("is ready immediately in mock mode (no service needed)", () => {
    poc.genetecPlayerMode = "mock";
    const { result } = renderHook(() => useMediaGatewayService(true, cameras));
    expect(result.current).toMatchObject({
      multiplexed: true,
      service: null,
      ready: true
    });
    expect(loadGwpScript).not.toHaveBeenCalled();
  });

  describe("token failures are recorded in the stats store (C5)", () => {
    const retrieverOfService = async () => {
      const { result } = renderHook(() => useMediaGatewayService(true, cameras));
      await waitFor(() => expect(result.current.ready).toBe(true));
      return gwp.buildMediaGatewayService.mock.calls[0][1] as (
        guid: string
      ) => Promise<string>;
    };

    beforeEach(() => {
      resetStatsStore();
      resetStreamed();
      useStatsStore.getState().startPhase({ cameraCount: 4, multiplexed: false });
    });
    afterEach(() => useStatsStore.getState().stopPhase());

    it("records a failure before Streaming as source token and rethrows", async () => {
      (getGenetecToken as jest.Mock).mockRejectedValue(new Error("down"));
      const retrieve = await retrieverOfService();
      await expect(retrieve("guid-2")).rejects.toThrow("down");
      expect(getEvents()).toHaveLength(1);
      expect(getEvents()[0]).toMatchObject({
        kind: "error",
        cameraId: "cam-2",
        source: "token"
      });
    });

    it("records a failure after Streaming as token-renewal", async () => {
      (getGenetecToken as jest.Mock).mockRejectedValue(new Error("down"));
      markStreamed("cam-2");
      const retrieve = await retrieverOfService();
      await expect(retrieve("guid-2")).rejects.toThrow("down");
      const errors = getEvents().filter((e) => e.kind === "error");
      expect(errors).toHaveLength(1);
      expect(errors[0]).toMatchObject({ source: "token-renewal" });
    });
  });
});

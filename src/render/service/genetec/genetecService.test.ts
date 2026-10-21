import apiLV from "@/render/service/apiLV";
import {
  getGenetecCameras,
  getGenetecToken
} from "@/render/service/genetec/genetecService";
import poc from "@/render/config/poc.config";

jest.mock("@/render/service/apiLV", () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn() },
  resolveToken: jest.fn()
}));

describe("genetecService (mock mode)", () => {
  beforeEach(() => {
    poc.useMockApi = true;
    jest.clearAllMocks();
  });

  it("returns 32 mock cameras around Medellin with offline and ptz variety", async () => {
    const cameras = await getGenetecCameras();
    expect(cameras).toHaveLength(32);
    expect(cameras.some((c) => c.status === "offline")).toBe(true);
    expect(cameras.some((c) => c.ptz)).toBe(true);
    expect(cameras.every((c) => c.provider === "genetec")).toBe(true);
    cameras.forEach((c) => {
      expect(Math.abs((c.lat as number) - 6.2442)).toBeLessThan(0.1);
      expect(Math.abs((c.lng as number) + 75.5812)).toBeLessThan(0.1);
    });
    expect(apiLV.get).not.toHaveBeenCalled();
  });

  it("returns a fake token expiring in about 5 minutes", async () => {
    const before = Date.now();
    const res = await getGenetecToken("cam-1");
    const delta = new Date(res.expiresAt).getTime() - before;
    expect(res.token).toEqual(expect.any(String));
    expect(delta).toBeGreaterThan(4 * 60_000);
    expect(delta).toBeLessThanOrEqual(5 * 60_000 + 2000);
    expect(res.mediaGatewayUrl).toEqual(expect.any(String));
    expect(apiLV.post).not.toHaveBeenCalled();
  });
});

describe("genetecService (real API mode)", () => {
  beforeEach(() => {
    poc.useMockApi = false;
    jest.clearAllMocks();
  });
  afterAll(() => {
    poc.useMockApi = true;
  });

  it("GETs /genetec/cameras", async () => {
    (apiLV.get as jest.Mock).mockResolvedValue({ data: [{ id: "1" }] });
    await expect(getGenetecCameras()).resolves.toEqual([{ id: "1" }]);
    expect(apiLV.get).toHaveBeenCalledWith("/genetec/cameras");
  });

  it("POSTs /genetec/token with the camera id", async () => {
    const payload = { token: "t", expiresAt: "x", mediaGatewayUrl: "u" };
    (apiLV.post as jest.Mock).mockResolvedValue({ data: payload });
    await expect(getGenetecToken("cam-9")).resolves.toEqual(payload);
    expect(apiLV.post).toHaveBeenCalledWith("/genetec/token", {
      cameraId: "cam-9"
    });
  });
});

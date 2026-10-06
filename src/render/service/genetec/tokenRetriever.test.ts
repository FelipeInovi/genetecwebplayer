import { createTokenRetriever } from "@/render/service/genetec/tokenRetriever";
import type { GenetecTokenResponse } from "@/render/types/genetec";

const NOW = 1_000_000;
const resp = (token: string, ttlMs: number): GenetecTokenResponse => ({
  token,
  expiresAt: new Date(NOW + ttlMs).toISOString(),
  mediaGatewayUrl: "https://mg.test"
});

const GUID_TO_ID: Record<string, string> = { "guid-1": "cam-1", "guid-2": "cam-2" };
const build = (
  fetchToken: jest.Mock,
  now: () => number = () => NOW,
  marginMs = 10_000
) =>
  createTokenRetriever({
    fetchToken,
    resolveCameraId: (guid) => GUID_TO_ID[guid],
    now,
    marginMs
  });

describe("createTokenRetriever", () => {
  it("maps the GWP camera GUID to our camera id", async () => {
    const fetchToken = jest.fn().mockResolvedValue(resp("t1", 60_000));
    await build(fetchToken)("guid-1");
    expect(fetchToken).toHaveBeenCalledWith("cam-1");
  });

  it("rejects for an unknown GUID without fetching", async () => {
    const fetchToken = jest.fn();
    await expect(build(fetchToken)("nope")).rejects.toThrow(/unknown camera/i);
    expect(fetchToken).not.toHaveBeenCalled();
  });

  it("serves cached tokens until the refresh margin before expiry", async () => {
    let now = NOW;
    const fetchToken = jest
      .fn()
      .mockResolvedValueOnce(resp("t1", 60_000))
      .mockResolvedValueOnce(resp("t2", 60_000));
    const retrieve = build(fetchToken, () => now);
    await expect(retrieve("guid-1")).resolves.toBe("t1");
    now = NOW + 49_000; // 11s before expiry: still fresh
    await expect(retrieve("guid-1")).resolves.toBe("t1");
    expect(fetchToken).toHaveBeenCalledTimes(1);
    now = NOW + 51_000; // inside the 10s margin: refresh
    await expect(retrieve("guid-1")).resolves.toBe("t2");
    expect(fetchToken).toHaveBeenCalledTimes(2);
  });

  it("caches per camera", async () => {
    const fetchToken = jest
      .fn()
      .mockImplementation(async (id: string) => resp(`tok-${id}`, 60_000));
    const retrieve = build(fetchToken);
    await expect(retrieve("guid-1")).resolves.toBe("tok-cam-1");
    await expect(retrieve("guid-2")).resolves.toBe("tok-cam-2");
    expect(fetchToken).toHaveBeenCalledTimes(2);
  });

  it("de-duplicates concurrent in-flight requests per camera", async () => {
    let resolve!: (r: GenetecTokenResponse) => void;
    const fetchToken = jest.fn(
      () => new Promise<GenetecTokenResponse>((r) => (resolve = r))
    );
    const retrieve = build(fetchToken);
    const a = retrieve("guid-1");
    const b = retrieve("guid-1");
    resolve(resp("shared", 60_000));
    await expect(Promise.all([a, b])).resolves.toEqual(["shared", "shared"]);
    expect(fetchToken).toHaveBeenCalledTimes(1);
  });

  it("rethrows transient errors without poisoning the cache", async () => {
    const fetchToken = jest
      .fn()
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce(resp("ok", 60_000));
    const retrieve = build(fetchToken);
    await expect(retrieve("guid-1")).rejects.toThrow("network");
    await expect(retrieve("guid-1")).resolves.toBe("ok");
    expect(fetchToken).toHaveBeenCalledTimes(2);
  });

  it("does not cache tokens with an invalid expiresAt", async () => {
    const fetchToken = jest.fn().mockResolvedValue({
      ...resp("t", 60_000),
      expiresAt: "garbage"
    });
    const retrieve = build(fetchToken);
    await retrieve("guid-1");
    await retrieve("guid-1");
    expect(fetchToken).toHaveBeenCalledTimes(2);
  });
});

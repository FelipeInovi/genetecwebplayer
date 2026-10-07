import { GenetecForbiddenError, TokenExpiredError } from "@/render/service/errors";
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
    marginMs,
    rng: () => 0
  });

const httpError = (status: number) =>
  Object.assign(new Error(`HTTP ${status}`), {
    isAxiosError: true,
    response: { status }
  });
const networkError = () =>
  Object.assign(new Error("Network Error"), {
    isAxiosError: true,
    code: "ERR_NETWORK"
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

  it("refetches exactly at the boundary expiresAt - margin == now (C7)", async () => {
    let now = NOW;
    const fetchToken = jest
      .fn()
      .mockResolvedValueOnce(resp("a", 60_000))
      .mockResolvedValueOnce(resp("b", 60_000));
    const retrieve = build(fetchToken, () => now);
    await retrieve("guid-1");
    now = NOW + 60_000 - 10_000 - 1;
    await expect(retrieve("guid-1")).resolves.toBe("a");
    now = NOW + 60_000 - 10_000;
    await expect(retrieve("guid-1")).resolves.toBe("b");
  });

  it("gives every concurrent caller the in-flight rejection, then refetches (C7)", async () => {
    const fetchToken = jest
      .fn()
      .mockRejectedValueOnce(new TokenExpiredError())
      .mockResolvedValueOnce(resp("ok", 60_000));
    const retrieve = build(fetchToken);
    const results = await Promise.allSettled([
      retrieve("guid-1"),
      retrieve("guid-1"),
      retrieve("guid-1")
    ]);
    expect(results.map((r) => r.status)).toEqual([
      "rejected",
      "rejected",
      "rejected"
    ]);
    expect(fetchToken).toHaveBeenCalledTimes(1);
    await expect(retrieve("guid-1")).resolves.toBe("ok");
    expect(fetchToken).toHaveBeenCalledTimes(2);
  });

  describe("refresh jitter (C4)", () => {
    it("adds a per-camera random 0..10s on top of the margin", async () => {
      let now = NOW;
      const rng = jest.fn().mockReturnValueOnce(1).mockReturnValueOnce(0);
      const fetchToken = jest.fn().mockResolvedValue(resp("t", 60_000));
      const retrieve = createTokenRetriever({
        fetchToken,
        resolveCameraId: (g) => GUID_TO_ID[g],
        now: () => now,
        marginMs: 10_000,
        rng
      });
      await retrieve("guid-1"); // margin 10s + 10s jitter => refetch at +40s
      await retrieve("guid-2"); // margin 10s + 0 => refetch at +50s
      fetchToken.mockClear();
      now = NOW + 39_999;
      await retrieve("guid-1");
      await retrieve("guid-2");
      expect(fetchToken).not.toHaveBeenCalled();
      now = NOW + 40_000;
      await retrieve("guid-1");
      await retrieve("guid-2");
      expect(fetchToken.mock.calls).toEqual([["cam-1"]]);
    });
  });

  describe("concurrency cap (C4)", () => {
    it("runs at most maxConcurrent fetches and queues the rest", async () => {
      const resolvers: Array<(r: GenetecTokenResponse) => void> = [];
      const fetchToken = jest.fn(
        () => new Promise<GenetecTokenResponse>((r) => resolvers.push(r))
      );
      const retrieve = createTokenRetriever({
        fetchToken,
        resolveCameraId: (g) => g.replace("guid", "cam"),
        now: () => NOW,
        maxConcurrent: 2,
        rng: () => 0
      });
      const all = ["guid-1", "guid-2", "guid-3", "guid-4"].map((g) => retrieve(g));
      await Promise.resolve();
      expect(fetchToken).toHaveBeenCalledTimes(2);
      resolvers[0](resp("t1", 60_000));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      expect(fetchToken).toHaveBeenCalledTimes(3);
      resolvers[1](resp("t2", 60_000));
      resolvers[2](resp("t3", 60_000));
      await new Promise((r) => setTimeout(r, 0));
      resolvers[3](resp("t4", 60_000));
      await expect(Promise.all(all)).resolves.toEqual(["t1", "t2", "t3", "t4"]);
    });

    it("defaults to 4 concurrent fetches", async () => {
      const fetchToken = jest.fn(() => new Promise<GenetecTokenResponse>(() => undefined));
      const retrieve = createTokenRetriever({
        fetchToken,
        resolveCameraId: (g) => g,
        now: () => NOW
      });
      for (let i = 0; i < 6; i += 1) void retrieve(`g${i}`);
      await Promise.resolve();
      expect(fetchToken).toHaveBeenCalledTimes(4);
    });
  });

  describe("retry with backoff (C4)", () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it("retries a network error after 500ms and then succeeds", async () => {
      const fetchToken = jest
        .fn()
        .mockRejectedValueOnce(networkError())
        .mockResolvedValueOnce(resp("ok", 60_000));
      const p = build(fetchToken)("guid-1");
      await jest.advanceTimersByTimeAsync(499);
      expect(fetchToken).toHaveBeenCalledTimes(1);
      await jest.advanceTimersByTimeAsync(1);
      await expect(p).resolves.toBe("ok");
      expect(fetchToken).toHaveBeenCalledTimes(2);
    });

    it.each([502, 503, 504])("retries HTTP %i twice (500ms then 1500ms) and gives up", async (status) => {
      const fetchToken = jest.fn().mockRejectedValue(httpError(status));
      const p = build(fetchToken)("guid-1");
      const settled = p.catch((e: unknown) => e);
      await jest.advanceTimersByTimeAsync(500);
      expect(fetchToken).toHaveBeenCalledTimes(2);
      await jest.advanceTimersByTimeAsync(1499);
      expect(fetchToken).toHaveBeenCalledTimes(2);
      await jest.advanceTimersByTimeAsync(1);
      expect(fetchToken).toHaveBeenCalledTimes(3);
      await expect(settled).resolves.toMatchObject({ message: `HTTP ${status}` });
    });

    it("never retries a 403 (GenetecForbiddenError)", async () => {
      const fetchToken = jest.fn().mockRejectedValue(new GenetecForbiddenError());
      await expect(build(fetchToken)("guid-1")).rejects.toBeInstanceOf(
        GenetecForbiddenError
      );
      await jest.advanceTimersByTimeAsync(5000);
      expect(fetchToken).toHaveBeenCalledTimes(1);
    });

    it("does not retry other HTTP errors such as 404", async () => {
      const fetchToken = jest.fn().mockRejectedValue(httpError(404));
      await expect(build(fetchToken)("guid-1")).rejects.toThrow("HTTP 404");
      expect(fetchToken).toHaveBeenCalledTimes(1);
    });
  });
});

/** @jest-environment node */
const {
  parseEnvFile,
  loadConfig,
  buildBasicAuthHeader,
  buildTokenUrl,
  findCamera,
  mapGatewayStatus,
  buildTokenResponse,
  route
} = require("./lib.cjs");

describe("parseEnvFile", () => {
  it("parses KEY=VALUE, ignores comments and blanks, strips quotes", () => {
    const env = parseEnvFile(
      ['# comment', "", "A=1", 'B="two words"', "C='x'", "D = spaced ", "E=a=b"].join("\n")
    );
    expect(env).toEqual({ A: "1", B: "two words", C: "x", D: "spaced", E: "a=b" });
  });
  it("handles CRLF", () => {
    expect(parseEnvFile("A=1\r\nB=2\r\n")).toEqual({ A: "1", B: "2" });
  });
});

describe("loadConfig", () => {
  const base = {
    MG_BASE_URL: "https://mg.test:8443/",
    MG_USERNAME: "u",
    MG_PASSWORD: "p",
    MG_SDK_CERTIFICATE: "cert"
  };
  it("applies defaults and normalizes the base URL", () => {
    expect(loadConfig(base)).toMatchObject({
      mgBaseUrl: "https://mg.test:8443",
      tokenTtlSeconds: 60,
      port: 8787,
      camerasFile: expect.stringContaining("cameras.local.json")
    });
  });
  it("reads overrides and falls back on invalid numbers", () => {
    expect(
      loadConfig({ ...base, TOKEN_TTL_SECONDS: "120", PROXY_PORT: "9000" })
    ).toMatchObject({ tokenTtlSeconds: 120, port: 9000 });
    expect(loadConfig({ ...base, TOKEN_TTL_SECONDS: "abc" }).tokenTtlSeconds).toBe(60);
  });
  it("names missing variables without echoing any value", () => {
    expect(() => loadConfig({ MG_USERNAME: "secret-user" })).toThrow(
      /MG_BASE_URL.*MG_PASSWORD.*MG_SDK_CERTIFICATE/
    );
    try {
      loadConfig({ MG_USERNAME: "secret-user" });
    } catch (e) {
      expect(e.message).not.toContain("secret-user");
    }
  });
});

describe("buildBasicAuthHeader", () => {
  it('encodes "user;sdkCert:password"', () => {
    const header = buildBasicAuthHeader({
      username: "bob",
      sdkCertificate: "CERT",
      password: "pw"
    });
    expect(header).toBe(
      `Basic ${Buffer.from("bob;CERT:pw").toString("base64")}`
    );
  });
});

describe("buildTokenUrl", () => {
  it("targets /media/v2/token/<externalId>", () => {
    expect(buildTokenUrl("https://mg.test:8443", "guid 1")).toBe(
      "https://mg.test:8443/media/v2/token/guid%201"
    );
  });
});

describe("findCamera", () => {
  const cams = [{ id: "a", externalId: "ga" }, { id: "b", externalId: "gb" }];
  it("finds by id", () => {
    expect(findCamera(cams, "b")).toBe(cams[1]);
  });
  it("returns undefined when missing or id invalid", () => {
    expect(findCamera(cams, "z")).toBeUndefined();
    expect(findCamera(cams, undefined)).toBeUndefined();
    expect(findCamera(cams, 5)).toBeUndefined();
  });
});

describe("mapGatewayStatus", () => {
  it("never returns 401 to the browser", () => {
    expect(mapGatewayStatus(401)).toBe(403);
    expect(mapGatewayStatus(403)).toBe(403);
  });
  it("maps the rest", () => {
    expect(mapGatewayStatus(404)).toBe(404);
    expect(mapGatewayStatus(500)).toBe(502);
    expect(mapGatewayStatus(503)).toBe(502);
    expect(mapGatewayStatus(418)).toBe(502);
  });
});

describe("buildTokenResponse", () => {
  it("computes expiresAt from the assumed TTL", () => {
    expect(buildTokenResponse("tok", 60, "https://mg.test", 1_000_000)).toEqual({
      token: "tok",
      expiresAt: new Date(1_060_000).toISOString(),
      mediaGatewayUrl: "https://mg.test"
    });
  });
});

describe("route", () => {
  const config = {
    mgBaseUrl: "https://mg.test",
    username: "u",
    password: "p",
    sdkCertificate: "c",
    tokenTtlSeconds: 60
  };
  const cameras = [{ id: "cam-1", externalId: "guid-1", name: "One" }];
  const deps = (fetchImpl) => ({
    config,
    loadCameras: () => cameras,
    fetchImpl,
    now: () => 1_000_000
  });
  const okFetch = () =>
    jest.fn().mockResolvedValue({ ok: true, status: 200, text: async () => "  raw-token\n" });

  it("serves the camera catalog", async () => {
    const res = await route({ method: "GET", path: "/api/genetec/cameras" }, deps(okFetch()));
    expect(res).toEqual({ status: 200, json: cameras });
  });

  it("reports a catalog loading problem as 500 with a hint", async () => {
    const d = deps(okFetch());
    d.loadCameras = () => {
      throw new Error("Camera catalog not found: cameras.local.json");
    };
    const res = await route({ method: "GET", path: "/api/genetec/cameras" }, d);
    expect(res.status).toBe(500);
    expect(res.json.message).toMatch(/catalog/i);
  });

  it("fetches a token from the gateway and returns the backend contract", async () => {
    const fetchImpl = okFetch();
    const res = await route(
      { method: "POST", path: "/api/genetec/token", body: { cameraId: "cam-1" } },
      deps(fetchImpl)
    );
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://mg.test/media/v2/token/guid-1",
      expect.objectContaining({
        method: "GET",
        headers: {
          Authorization: `Basic ${Buffer.from("u;c:p").toString("base64")}`
        }
      })
    );
    expect(res).toEqual({
      status: 200,
      json: {
        token: "raw-token",
        expiresAt: new Date(1_060_000).toISOString(),
        mediaGatewayUrl: "https://mg.test"
      }
    });
  });

  it("400 for a missing cameraId, 404 for an unknown camera", async () => {
    const d = deps(okFetch());
    expect((await route({ method: "POST", path: "/api/genetec/token", body: {} }, d)).status).toBe(400);
    expect(
      (await route({ method: "POST", path: "/api/genetec/token", body: { cameraId: "zzz" } }, d)).status
    ).toBe(404);
    expect(d.fetchImpl).not.toHaveBeenCalled();
  });

  it.each([401, 403])("maps gateway %i to 403", async (status) => {
    const fetchImpl = jest.fn().mockResolvedValue({ ok: false, status, text: async () => "BadCredentials" });
    const res = await route(
      { method: "POST", path: "/api/genetec/token", body: { cameraId: "cam-1" } },
      deps(fetchImpl)
    );
    expect(res.status).toBe(403);
  });

  it("maps gateway 500 and network failures to 502 without leaking secrets", async () => {
    const boom = jest.fn().mockRejectedValue(new Error("connect ECONNREFUSED u;c:p"));
    const res = await route(
      { method: "POST", path: "/api/genetec/token", body: { cameraId: "cam-1" } },
      deps(boom)
    );
    expect(res.status).toBe(502);
    expect(JSON.stringify(res.json)).not.toContain("u;c:p");
    const bad = jest.fn().mockResolvedValue({ ok: false, status: 500, text: async () => "x" });
    expect(
      (await route(
        { method: "POST", path: "/api/genetec/token", body: { cameraId: "cam-1" } },
        deps(bad)
      )).status
    ).toBe(502);
  });

  it("404s unknown routes and 405s wrong methods", async () => {
    const d = deps(okFetch());
    expect((await route({ method: "GET", path: "/nope" }, d)).status).toBe(404);
    expect((await route({ method: "GET", path: "/api/genetec/token" }, d)).status).toBe(405);
  });
});

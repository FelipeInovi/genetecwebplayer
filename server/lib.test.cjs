/** @jest-environment node */
const { EventEmitter } = require("node:events");
const {
  parseRequestPath,
  createRequestHandler,
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

  it("reports a catalog loading problem as a generic 500", async () => {
    const d = deps(okFetch());
    d.loadCameras = () => {
      throw new Error("Camera catalog not found: cameras.local.json");
    };
    const res = await route({ method: "GET", path: "/api/genetec/cameras" }, d);
    expect(res.status).toBe(500);
    expect(res.json.message).not.toMatch(/catalog/i);
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

describe("loadConfig (S2: Media Gateway URL)", () => {
  const withUrl = (MG_BASE_URL) => ({
    MG_BASE_URL,
    MG_USERNAME: "u",
    MG_PASSWORD: "p",
    MG_SDK_CERTIFICATE: "cert"
  });
  it.each([
    ["http://mg.test:8443", /https/i],
    ["https://user:pw@mg.test", /credentials/i],
    ["https://mg.test/some/path", /origin/i],
    ["https://mg.test/?x=1", /origin/i],
    ["https://mg.test/#frag", /origin/i],
    ["not a url", /valid URL/i]
  ])("rejects %s with a clear error that never echoes secrets", (url, message) => {
    expect(() => loadConfig(withUrl(url))).toThrow(message);
    try {
      loadConfig(withUrl(url));
    } catch (e) {
      expect(e.message).not.toContain("pw@");
    }
  });
  it("accepts an https origin with a port and a trailing slash", () => {
    expect(loadConfig(withUrl("https://mg.test:8443/")).mgBaseUrl).toBe(
      "https://mg.test:8443"
    );
  });
});

describe("request guards (S1)", () => {
  const {
    isHostAllowed,
    buildAllowedOrigins,
    isOriginAllowed,
    hasJsonContentType,
    checkRequest,
    formatRequestLog
  } = require("./lib.cjs");

  it("allows only 127.0.0.1:<port> and localhost:<port> as Host", () => {
    expect(isHostAllowed("127.0.0.1:8787", 8787)).toBe(true);
    expect(isHostAllowed("localhost:8787", 8787)).toBe(true);
    expect(isHostAllowed("LOCALHOST:8787", 8787)).toBe(true);
    expect(isHostAllowed("evil.test:8787", 8787)).toBe(false);
    expect(isHostAllowed("127.0.0.1:9999", 8787)).toBe(false);
    expect(isHostAllowed("127.0.0.1", 8787)).toBe(false);
    expect(isHostAllowed(undefined, 8787)).toBe(false);
    expect(isHostAllowed("localhost:8787.evil.test", 8787)).toBe(false);
  });

  it("builds the origin allowlist from the Vite port and ALLOWED_ORIGINS", () => {
    expect(buildAllowedOrigins(3000, undefined)).toEqual([
      "http://localhost:3000",
      "http://127.0.0.1:3000"
    ]);
    expect(buildAllowedOrigins(3000, " https://a.test , ,https://b.test ")).toEqual([
      "http://localhost:3000",
      "http://127.0.0.1:3000",
      "https://a.test",
      "https://b.test"
    ]);
  });

  it("accepts a missing Origin and rejects one outside the allowlist", () => {
    const list = buildAllowedOrigins(3000, "");
    expect(isOriginAllowed(undefined, list)).toBe(true);
    expect(isOriginAllowed("", list)).toBe(true);
    expect(isOriginAllowed("http://localhost:3000", list)).toBe(true);
    expect(isOriginAllowed("http://evil.test", list)).toBe(false);
    expect(isOriginAllowed("null", list)).toBe(false);
  });

  it("requires application/json (any parameters) for POST", () => {
    expect(hasJsonContentType("application/json")).toBe(true);
    expect(hasJsonContentType("Application/JSON; charset=utf-8")).toBe(true);
    expect(hasJsonContentType("text/plain")).toBe(false);
    expect(hasJsonContentType("application/jsonp")).toBe(false);
    expect(hasJsonContentType(undefined)).toBe(false);
  });

  describe("checkRequest", () => {
    const ctx = { port: 8787, allowedOrigins: buildAllowedOrigins(3000, "") };
    const ok = {
      method: "POST",
      host: "127.0.0.1:8787",
      origin: "http://localhost:3000",
      contentType: "application/json"
    };
    it("passes a valid request (also without Origin, as the Vite proxy forwards)", () => {
      expect(checkRequest(ok, ctx)).toBeNull();
      expect(checkRequest({ ...ok, origin: undefined }, ctx)).toBeNull();
      expect(checkRequest({ method: "GET", host: "localhost:8787" }, ctx)).toBeNull();
    });
    it("403s a foreign Host before anything else", () => {
      expect(checkRequest({ ...ok, host: "evil.test" }, ctx)).toMatchObject({
        status: 403,
        json: { code: "forbidden-host" }
      });
    });
    it("403s an Origin that is not allowlisted", () => {
      expect(checkRequest({ ...ok, origin: "http://evil.test" }, ctx)).toMatchObject({
        status: 403,
        json: { code: "forbidden-origin" }
      });
    });
    it("415s a POST that is not JSON", () => {
      expect(checkRequest({ ...ok, contentType: "text/plain" }, ctx)).toMatchObject({
        status: 415,
        json: { code: "unsupported-media-type" }
      });
    });
  });

  it("loadConfig exposes the port and the origin allowlist", () => {
    const cfg = loadConfig({
      MG_BASE_URL: "https://mg.test",
      MG_USERNAME: "u",
      MG_PASSWORD: "p",
      MG_SDK_CERTIFICATE: "c",
      ALLOWED_ORIGINS: "https://x.test"
    });
    expect(cfg.allowedOrigins).toContain("https://x.test");
    expect(cfg.allowedOrigins).toContain("http://localhost:3000");
  });

  it("formats a one-line request log without query strings or credentials", () => {
    expect(
      formatRequestLog({ method: "POST", path: "/api/genetec/token", status: 200, ms: 12.4 })
    ).toBe("POST /api/genetec/token 200 12ms");
  });
});

describe("route (S1: error codes and generic 500s)", () => {
  const config = {
    mgBaseUrl: "https://mg.test",
    username: "u",
    password: "p",
    sdkCertificate: "c",
    tokenTtlSeconds: 60
  };
  const cameras = [{ id: "cam-1", externalId: "guid-1", name: "One" }];
  const base = (fetchImpl, extra = {}) => ({
    config,
    loadCameras: () => cameras,
    fetchImpl,
    now: () => 1_000_000,
    ...extra
  });
  const tokenReq = { method: "POST", path: "/api/genetec/token", body: { cameraId: "cam-1" } };

  it.each([401, 403])("tags gateway %i as forbidden-upstream", async (status) => {
    const f = jest.fn().mockResolvedValue({ ok: false, status, text: async () => "" });
    const res = await route(tokenReq, base(f));
    expect(res).toMatchObject({ status: 403, json: { code: "forbidden-upstream" } });
  });

  it("maps a fetch timeout to 504 upstream-timeout", async () => {
    const err = Object.assign(new Error("timed out"), { name: "TimeoutError" });
    const res = await route(tokenReq, base(jest.fn().mockRejectedValue(err)));
    expect(res).toMatchObject({ status: 504, json: { code: "upstream-timeout" } });
  });

  it("maps a network failure to 502 upstream-unreachable", async () => {
    const res = await route(tokenReq, base(jest.fn().mockRejectedValue(new Error("ECONNREFUSED"))));
    expect(res).toMatchObject({ status: 502, json: { code: "upstream-unreachable" } });
  });

  it("returns a generic 500 and logs the details locally only", async () => {
    const logError = jest.fn();
    const throwing = () => {
      throw new Error("Camera catalog not found: C:\\secret\\path\\cameras.local.json");
    };
    const res = await route(
      { method: "GET", path: "/api/genetec/cameras" },
      base(jest.fn(), { loadCameras: throwing, logError })
    );
    expect(res).toEqual({
      status: 500,
      json: { message: "Internal error", code: "internal-error" }
    });
    expect(JSON.stringify(res)).not.toContain("secret");
    expect(logError).toHaveBeenCalledWith(expect.stringContaining("Camera catalog not found"));
  });

  it("returns a generic 500 when the token route cannot load the catalog", async () => {
    const throwing = () => {
      throw new Error("bad json at C:\\x");
    };
    const res = await route(tokenReq, base(jest.fn(), { loadCameras: throwing }));
    expect(res).toMatchObject({ status: 500, json: { code: "internal-error" } });
    expect(JSON.stringify(res)).not.toContain("C:");
  });
});

describe("catalog loading (S2 GUID validation, C4 mtime cache)", () => {
  const { validateCatalog, createCatalogLoader } = require("./lib.cjs");
  const GUID = "00000000-0000-4000-8000-000000000001";
  const cam = (over = {}) => ({ id: "cam-1", externalId: GUID, name: "One", ...over });

  it("accepts GUID externalIds", () => {
    expect(validateCatalog([cam(), cam({ id: "cam-2", externalId: GUID.toUpperCase() })])).toHaveLength(2);
  });
  it.each([
    [[cam({ externalId: "guid-1" })], /externalId.*GUID/i],
    [[cam({ externalId: `${GUID}/../x` })], /externalId.*GUID/i],
    [[cam({ externalId: undefined })], /externalId.*GUID/i],
    [{ not: "an array" }, /array/i]
  ])("rejects an invalid catalog %#", (catalog, message) => {
    expect(() => validateCatalog(catalog)).toThrow(message);
  });
  it("names the offending camera id", () => {
    expect(() => validateCatalog([cam({ id: "cam-77", externalId: "x" })])).toThrow(/cam-77/);
  });

  describe("createCatalogLoader", () => {
    const build = () => {
      let mtimeMs = 1;
      let text = JSON.stringify([cam()]);
      const fsImpl = {
        statSync: jest.fn(() => ({ mtimeMs })),
        readFileSync: jest.fn(() => text)
      };
      const loader = createCatalogLoader("cameras.local.json", fsImpl);
      return {
        loader,
        fsImpl,
        touch: (next) => {
          mtimeMs += 1;
          text = next;
        }
      };
    };
    it("parses once while the file mtime is unchanged", () => {
      const { loader, fsImpl } = build();
      const first = loader();
      expect(loader()).toBe(first);
      expect(fsImpl.readFileSync).toHaveBeenCalledTimes(1);
    });
    it("reloads when the mtime changes", () => {
      const { loader, fsImpl, touch } = build();
      loader();
      touch(JSON.stringify([cam({ id: "cam-9" })]));
      expect(loader()[0].id).toBe("cam-9");
      expect(fsImpl.readFileSync).toHaveBeenCalledTimes(2);
    });
    it("rejects an invalid reload and keeps failing until fixed", () => {
      const { loader, touch } = build();
      loader();
      touch(JSON.stringify([cam({ externalId: "bad" })]));
      expect(() => loader()).toThrow(/GUID/);
      touch(JSON.stringify([cam()]));
      expect(loader()).toHaveLength(1);
    });
    it("explains a missing file", () => {
      const fsImpl = {
        statSync: () => {
          throw Object.assign(new Error("nope"), { code: "ENOENT" });
        },
        readFileSync: jest.fn()
      };
      expect(() => createCatalogLoader("cameras.local.json", fsImpl)()).toThrow(
        /catalog not found/i
      );
    });
  });
});

describe("parseRequestPath", () => {
  it("returns the pathname without the query", () => {
    expect(parseRequestPath("/api/genetec/cameras?x=1")).toBe("/api/genetec/cameras");
    expect(parseRequestPath(undefined)).toBe("/");
  });
  it("returns null for request targets that cannot be parsed", () => {
    expect(parseRequestPath("//")).toBeNull();
    expect(parseRequestPath("//:80")).toBeNull();
  });
});

describe("createRequestHandler", () => {
  const config = { port: 8787, allowedOrigins: [], maxBodyBytes: 10 };
  let calls;
  const makeReq = (over = {}) => {
    const req = new EventEmitter();
    Object.assign(
      req,
      {
        method: "GET",
        url: "/api/genetec/cameras",
        headers: { host: "127.0.0.1:8787" },
        destroy: jest.fn(() => {
          calls.push("destroy");
        })
      },
      over
    );
    return req;
  };
  const makeRes = (opts = {}) => {
    const res = {
      writeHead: jest.fn((status, headers) => {
        if (opts.failFirstWrite && res.writeHead.mock.calls.length === 1) throw new Error("boom");
        calls.push(`writeHead:${status}`);
        res.headers = headers;
      }),
      end: jest.fn((body, cb) => {
        calls.push("end");
        res.body = body;
        if (cb) cb();
      })
    };
    return res;
  };
  const build = () =>
    createRequestHandler({
      config,
      loadCameras: () => [],
      fetchImpl: jest.fn(),
      now: () => 0,
      logError: jest.fn(),
      log: jest.fn()
    });
  beforeEach(() => {
    calls = [];
  });

  it("answers 400 bad-request for an unparseable request target", async () => {
    const res = makeRes();
    await build()(makeReq({ url: "//" }), res);
    expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
    expect(JSON.parse(res.body)).toMatchObject({ code: "bad-request" });
  });

  it("sends 413 before destroying the request, with Connection: close", async () => {
    const req = makeReq({
      method: "POST",
      headers: { host: "127.0.0.1:8787", "content-type": "application/json" },
      url: "/api/genetec/token"
    });
    const res = makeRes();
    const done = build()(req, res);
    await new Promise((r) => setImmediate(r));
    req.emit("data", Buffer.alloc(50));
    await done;
    expect(JSON.parse(res.body)).toMatchObject({ code: "payload-too-large" });
    expect(res.headers).toMatchObject({ Connection: "close" });
    expect(calls).toEqual(["writeHead:413", "end", "destroy"]);
  });

  it("never rejects: a failing response write falls back to a generic 500", async () => {
    const res = makeRes({ failFirstWrite: true });
    await expect(build()(makeReq(), res)).resolves.toBeUndefined();
    expect(res.writeHead).toHaveBeenLastCalledWith(500, expect.any(Object));
  });
});

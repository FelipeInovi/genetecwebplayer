import { AxiosError, InternalAxiosRequestConfig } from "axios";
import env from "@/render/config/env";
import apiLV, { resolveToken } from "@/render/service/apiLV";
import {
  GenetecForbiddenError,
  TokenExpiredError
} from "@/render/service/errors";

const respondWith = (status: number, config: InternalAxiosRequestConfig) => {
  const response = { data: {}, status, statusText: "", headers: {}, config };
  if (status >= 400) {
    return Promise.reject(
      new AxiosError("fail", String(status), config, null, response as never)
    );
  }
  return Promise.resolve(response);
};

describe("resolveToken", () => {
  beforeEach(() => {
    localStorage.clear();
    env.VITE_DEV_BEARER_TOKEN = "";
  });

  it("prefers localStorage.accessToken over the env token", () => {
    localStorage.setItem("accessToken", "ls-token");
    env.VITE_DEV_BEARER_TOKEN = "env-token";
    expect(resolveToken()).toBe("ls-token");
  });

  it("falls back to the env token", () => {
    env.VITE_DEV_BEARER_TOKEN = "env-token";
    expect(resolveToken()).toBe("env-token");
  });

  it("returns null when no token exists", () => {
    expect(resolveToken()).toBeNull();
  });
});

describe("apiLV interceptors", () => {
  beforeEach(() => {
    localStorage.clear();
    env.VITE_DEV_BEARER_TOKEN = "";
  });

  it("sends the Authorization header when a token exists", async () => {
    localStorage.setItem("accessToken", "abc");
    let auth: unknown;
    apiLV.defaults.adapter = (config) => {
      auth = config.headers.get("Authorization");
      return respondWith(200, config) as never;
    };
    await apiLV.get("/x");
    expect(auth).toBe("Bearer abc");
  });

  it("omits the Authorization header without a token", async () => {
    let auth: unknown = "unset";
    apiLV.defaults.adapter = (config) => {
      auth = config.headers.get("Authorization");
      return respondWith(200, config) as never;
    };
    await apiLV.get("/x");
    expect(auth).toBeFalsy();
  });

  it("maps 401 to TokenExpiredError and keeps localStorage intact", async () => {
    localStorage.setItem("accessToken", "abc");
    localStorage.setItem("refreshToken", "r");
    apiLV.defaults.adapter = (config) => respondWith(401, config) as never;
    await expect(apiLV.get("/x")).rejects.toBeInstanceOf(TokenExpiredError);
    expect(localStorage.getItem("accessToken")).toBe("abc");
    expect(localStorage.getItem("refreshToken")).toBe("r");
  });

  it("maps 403 to GenetecForbiddenError", async () => {
    apiLV.defaults.adapter = (config) => respondWith(403, config) as never;
    await expect(apiLV.get("/x")).rejects.toBeInstanceOf(GenetecForbiddenError);
  });

  it("passes other errors through untouched", async () => {
    apiLV.defaults.adapter = (config) => respondWith(500, config) as never;
    await expect(apiLV.get("/x")).rejects.toBeInstanceOf(AxiosError);
  });
});

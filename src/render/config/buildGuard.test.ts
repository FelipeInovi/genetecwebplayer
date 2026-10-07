import { assertNoDevTokenInBuild } from "@/render/config/buildGuard";
import { resolveDevBearerToken } from "@/render/config/devToken";

describe("resolveDevBearerToken (S3)", () => {
  it("returns the token only in dev", () => {
    expect(resolveDevBearerToken(true, "abc")).toBe("abc");
    expect(resolveDevBearerToken(false, "abc")).toBe("");
  });
  it("defaults to an empty string", () => {
    expect(resolveDevBearerToken(true, undefined)).toBe("");
  });
});

describe("assertNoDevTokenInBuild (S3)", () => {
  it("throws for a production build with a dev token, without echoing it", () => {
    let message = "";
    try {
      assertNoDevTokenInBuild("build", "production", { VITE_DEV_BEARER_TOKEN: "s3cret" });
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toMatch(/VITE_DEV_BEARER_TOKEN/);
    expect(message).not.toContain("s3cret");
  });
  it("allows production builds without a token", () => {
    expect(() =>
      assertNoDevTokenInBuild("build", "production", { VITE_DEV_BEARER_TOKEN: "" })
    ).not.toThrow();
    expect(() => assertNoDevTokenInBuild("build", "production", {})).not.toThrow();
  });
  it.each(["staging", "production", "development"])(
    "throws for a build in mode %s with a dev token",
    (mode) => {
      expect(() =>
        assertNoDevTokenInBuild("build", mode, { VITE_DEV_BEARER_TOKEN: "s3cret" })
      ).toThrow(/VITE_DEV_BEARER_TOKEN/);
    }
  );
  it("allows the dev server", () => {
    expect(() =>
      assertNoDevTokenInBuild("serve", "development", { VITE_DEV_BEARER_TOKEN: "x" })
    ).not.toThrow();
  });
});

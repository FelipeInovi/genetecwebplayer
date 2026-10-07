import { toError } from "@/render/service/errors";

describe("toError", () => {
  it("returns an Error instance untouched", () => {
    const e = new TypeError("x");
    expect(toError(e)).toBe(e);
  });

  it("wraps non-Error values with their string form", () => {
    expect(toError("boom")).toEqual(new Error("boom"));
    expect(toError(42).message).toBe("42");
    expect(toError(undefined).message).toBe("undefined");
  });
});

import { getGridColumns } from "@/render/pages/Genetec/components/getGridColumns";

describe("getGridColumns", () => {
  it.each([
    [1, 1],
    [2, 2],
    [4, 2],
    [8, 4],
    [16, 4],
    [32, 8]
  ])("count %i -> %i columns", (count, cols) => {
    expect(getGridColumns(count)).toBe(cols);
  });

  it("falls back to 1 for zero or negative counts", () => {
    expect(getGridColumns(0)).toBe(1);
    expect(getGridColumns(-3)).toBe(1);
  });

  it("uses ceil(sqrt) for non-standard counts", () => {
    expect(getGridColumns(9)).toBe(3);
    expect(getGridColumns(5)).toBe(3);
  });
});

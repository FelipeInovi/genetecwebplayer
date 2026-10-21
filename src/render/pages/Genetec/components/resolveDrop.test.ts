import { resolveDrop } from "@/render/pages/Genetec/components/resolveDrop";

describe("resolveDrop", () => {
  it("assigns a camera dragged from the list to the cell under it", () => {
    expect(
      resolveDrop(
        { type: "camera", cameraId: "c9" },
        { type: "mosaic-cell", index: 2 }
      )
    ).toEqual({ cellIndex: 2, cameraId: "c9" });
  });

  it("moves (swaps) the camera of a dragged cell onto another cell", () => {
    expect(
      resolveDrop(
        { type: "mosaic-cell", cameraId: "c1" },
        { type: "mosaic-cell", index: 3 }
      )
    ).toEqual({ cellIndex: 3, cameraId: "c1" });
  });

  it("ignores drops outside any cell", () => {
    expect(resolveDrop({ type: "camera", cameraId: "c9" }, undefined)).toBeNull();
    expect(
      resolveDrop({ type: "camera", cameraId: "c9" }, { type: "other" })
    ).toBeNull();
  });

  it("ignores drags that carry no camera", () => {
    expect(resolveDrop(undefined, { type: "mosaic-cell", index: 0 })).toBeNull();
    expect(
      resolveDrop({ type: "camera" }, { type: "mosaic-cell", index: 0 })
    ).toBeNull();
  });
});

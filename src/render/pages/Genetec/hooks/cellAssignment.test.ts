import {
  assignCamera,
  clearCell,
  createAssignment,
  describeGroup,
  diffAssignment,
  nextGroup,
  previousGroup,
  resizeAssignment
} from "@/render/pages/Genetec/hooks/cellAssignment";

const ids = (n: number) => Array.from({ length: n }, (_, i) => `c${i + 1}`);

describe("createAssignment", () => {
  it("fills the cells with the first cameras of the catalog", () => {
    expect(createAssignment(ids(32), 4)).toEqual(["c1", "c2", "c3", "c4"]);
  });

  it("leaves the extra cells empty when the catalog is smaller", () => {
    expect(createAssignment(ids(2), 4)).toEqual(["c1", "c2", null, null]);
  });

  it("returns only empty cells for an empty catalog", () => {
    expect(createAssignment([], 3)).toEqual([null, null, null]);
  });
});

describe("resizeAssignment", () => {
  it("keeps the existing assignments and fills new cells with unassigned cameras", () => {
    expect(resizeAssignment(["c9", "c2"], 4, ids(10))).toEqual([
      "c9",
      "c2",
      "c1",
      "c3"
    ]);
  });

  it("truncates when the mosaic shrinks", () => {
    expect(resizeAssignment(["c1", "c2", "c3", "c4"], 2, ids(10))).toEqual([
      "c1",
      "c2"
    ]);
  });

  it("fills empty slots of the same size with unassigned cameras", () => {
    expect(resizeAssignment(["c5", null, "c1", null], 4, ids(6))).toEqual([
      "c5",
      "c2",
      "c1",
      "c3"
    ]);
  });

  it("drops cameras that left the catalog", () => {
    expect(resizeAssignment(["gone", "c2"], 2, ids(3))).toEqual(["c1", "c2"]);
  });

  it("builds a full assignment from an empty one (catalog arrived late)", () => {
    expect(resizeAssignment([], 4, ids(8))).toEqual(["c1", "c2", "c3", "c4"]);
  });

  it("never duplicates a camera", () => {
    const out = resizeAssignment(["c1", "c1", null], 4, ids(5));
    expect(new Set(out.filter(Boolean)).size).toBe(out.filter(Boolean).length);
    expect(out).toEqual(["c1", "c2", "c3", "c4"]);
  });
});

describe("assignCamera", () => {
  it("puts a free camera in the cell", () => {
    expect(assignCamera(["c1", "c2", "c3", "c4"], 1, "c9")).toEqual([
      "c1",
      "c9",
      "c3",
      "c4"
    ]);
  });

  it("swaps with the other cell when the camera is already displayed", () => {
    expect(assignCamera(["c1", "c2", "c3", "c4"], 0, "c3")).toEqual([
      "c3",
      "c2",
      "c1",
      "c4"
    ]);
  });

  it("moves the camera into an empty cell, leaving the source empty", () => {
    expect(assignCamera(["c1", null, "c3"], 1, "c3")).toEqual([
      "c1",
      "c3",
      null
    ]);
  });

  it("is a no-op for the same camera in the same cell", () => {
    const current = ["c1", "c2"];
    expect(assignCamera(current, 0, "c1")).toBe(current);
  });

  it("ignores an out-of-range cell", () => {
    const current = ["c1", "c2"];
    expect(assignCamera(current, 5, "c9")).toBe(current);
  });

  it("does not mutate its input", () => {
    const current = ["c1", "c2"];
    assignCamera(current, 0, "c2");
    expect(current).toEqual(["c1", "c2"]);
  });
});

describe("clearCell", () => {
  it("empties only that cell", () => {
    expect(clearCell(["c1", "c2", "c3"], 1)).toEqual(["c1", null, "c3"]);
  });

  it("returns the same array when the cell is already empty or out of range", () => {
    const current = ["c1", null];
    expect(clearCell(current, 1)).toBe(current);
    expect(clearCell(current, 7)).toBe(current);
  });
});

describe("nextGroup / previousGroup", () => {
  it("advances by the cell count over the catalog order", () => {
    expect(nextGroup(["c1", "c2", "c3", "c4"], ids(32))).toEqual([
      "c5",
      "c6",
      "c7",
      "c8"
    ]);
  });

  it("wraps from the last group back to the first (32 cameras, 4 cells)", () => {
    expect(nextGroup(["c29", "c30", "c31", "c32"], ids(32))).toEqual([
      "c1",
      "c2",
      "c3",
      "c4"
    ]);
  });

  it("goes back by the cell count and wraps to the last group", () => {
    expect(previousGroup(["c5", "c6", "c7", "c8"], ids(32))).toEqual([
      "c1",
      "c2",
      "c3",
      "c4"
    ]);
    expect(previousGroup(["c1", "c2", "c3", "c4"], ids(32))).toEqual([
      "c29",
      "c30",
      "c31",
      "c32"
    ]);
  });

  it("shows a partial last group (empty cells) when the catalog is not divisible", () => {
    const last = nextGroup(["c5", "c6", "c7", "c8"], ids(10));
    expect(last).toEqual(["c9", "c10", null, null]);
    expect(nextGroup(last, ids(10))).toEqual(["c1", "c2", "c3", "c4"]);
    expect(previousGroup(["c1", "c2", "c3", "c4"], ids(10))).toEqual([
      "c9",
      "c10",
      null,
      null
    ]);
  });

  it("starts from the first group when nothing is assigned", () => {
    expect(nextGroup([null, null], ids(6))).toEqual(["c3", "c4"]);
    expect(previousGroup([null, null], ids(6))).toEqual(["c5", "c6"]);
  });

  it("advances from the first assigned camera after a manual pick", () => {
    expect(nextGroup(["c20", "c2", "c3", "c4"], ids(32))).toEqual([
      "c24",
      "c25",
      "c26",
      "c27"
    ]);
  });

  it("keeps the group alignment when a cell of the group was cleared", () => {
    expect(nextGroup([null, "c6", "c7", "c8"], ids(32))).toEqual([
      "c9",
      "c10",
      "c11",
      "c12"
    ]);
  });

  it("returns an empty mosaic for an empty catalog", () => {
    expect(nextGroup(["c1", "c2"], [])).toEqual([null, null]);
    expect(previousGroup(["c1", "c2"], [])).toEqual([null, null]);
  });

  it("keeps the same group when the catalog fits in the mosaic", () => {
    expect(nextGroup(["c1", "c2", null, null], ids(2))).toEqual([
      "c1",
      "c2",
      null,
      null
    ]);
  });
});

describe("describeGroup", () => {
  it("describes a contiguous group as 1-based range of the catalog", () => {
    expect(describeGroup(["c5", "c6", "c7", "c8"], ids(32))).toEqual({
      from: 5,
      to: 8,
      total: 32
    });
  });

  it("accepts trailing empty cells (partial last group)", () => {
    expect(describeGroup(["c9", "c10", null, null], ids(10))).toEqual({
      from: 9,
      to: 10,
      total: 10
    });
  });

  it("returns null for a custom (non contiguous) assignment", () => {
    expect(describeGroup(["c1", "c3", "c4", "c5"], ids(10))).toBeNull();
    expect(describeGroup(["c2", "c1"], ids(10))).toBeNull();
    expect(describeGroup(["c1", null, "c3"], ids(10))).toBeNull();
  });

  it("returns null when nothing is assigned", () => {
    expect(describeGroup([null, null], ids(10))).toBeNull();
  });
});

describe("diffAssignment", () => {
  it("lists the cells that now show another camera", () => {
    expect(
      diffAssignment(["c1", "c2", "c3"], ["c1", "c9", "c3"])
    ).toEqual([{ cellIndex: 1, cameraId: "c9", previousCameraId: "c2" }]);
  });

  it("reports both cells of a swap", () => {
    expect(diffAssignment(["c1", "c2"], ["c2", "c1"])).toEqual([
      { cellIndex: 0, cameraId: "c2", previousCameraId: "c1" },
      { cellIndex: 1, cameraId: "c1", previousCameraId: "c2" }
    ]);
  });

  it("ignores cleared cells and unchanged cells", () => {
    expect(diffAssignment(["c1", "c2"], ["c1", null])).toEqual([]);
  });

  it("reports a camera placed in a previously empty or new cell", () => {
    expect(diffAssignment(["c1", null], ["c1", "c4", "c5"])).toEqual([
      { cellIndex: 1, cameraId: "c4", previousCameraId: null },
      { cellIndex: 2, cameraId: "c5", previousCameraId: null }
    ]);
  });
});

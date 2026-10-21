import { act, renderHook } from "@testing-library/react";
import { useCellAssignment } from "@/render/pages/Genetec/hooks/useCellAssignment";

const ids = (n: number) => Array.from({ length: n }, (_, i) => `c${i + 1}`);

type Props = { cameraIds: string[]; cellCount: number };

const setup = (initial: Props) =>
  renderHook((props: Props) => useCellAssignment(props.cameraIds, props.cellCount), {
    initialProps: initial
  });

describe("useCellAssignment", () => {
  it("starts with the first cameras of the catalog", () => {
    const { result } = setup({ cameraIds: ids(32), cellCount: 4 });
    expect(result.current.assignment).toEqual(["c1", "c2", "c3", "c4"]);
    expect(result.current.selectedCell).toBeNull();
  });

  it("fills the mosaic when the catalog arrives after the first render", () => {
    const { result, rerender } = setup({ cameraIds: [], cellCount: 4 });
    expect(result.current.assignment).toEqual([null, null, null, null]);
    rerender({ cameraIds: ids(8), cellCount: 4 });
    expect(result.current.assignment).toEqual(["c1", "c2", "c3", "c4"]);
  });

  it("resizes keeping the user's picks when the cell count changes", () => {
    const { result, rerender } = setup({ cameraIds: ids(32), cellCount: 4 });
    act(() => result.current.assign(0, "c20"));
    rerender({ cameraIds: ids(32), cellCount: 8 });
    expect(result.current.assignment).toEqual([
      "c20", "c2", "c3", "c4", "c1", "c5", "c6", "c7"
    ]);
    rerender({ cameraIds: ids(32), cellCount: 1 });
    expect(result.current.assignment).toEqual(["c20"]);
  });

  it("assigns the picked camera to the selected cell only", () => {
    const { result } = setup({ cameraIds: ids(32), cellCount: 4 });
    act(() => result.current.assignToSelected("c9"));
    expect(result.current.assignment).toEqual(["c1", "c2", "c3", "c4"]);
    act(() => result.current.selectCell(2));
    expect(result.current.selectedCell).toBe(2);
    act(() => result.current.assignToSelected("c9"));
    expect(result.current.assignment).toEqual(["c1", "c2", "c9", "c4"]);
  });

  it("toggles the selection when the same cell is selected twice", () => {
    const { result } = setup({ cameraIds: ids(8), cellCount: 4 });
    act(() => result.current.selectCell(1));
    act(() => result.current.selectCell(1));
    expect(result.current.selectedCell).toBeNull();
  });

  it("drops the selection when its cell no longer exists", () => {
    const { result, rerender } = setup({ cameraIds: ids(32), cellCount: 8 });
    act(() => result.current.selectCell(6));
    rerender({ cameraIds: ids(32), cellCount: 4 });
    expect(result.current.selectedCell).toBeNull();
  });

  it("clears a cell", () => {
    const { result } = setup({ cameraIds: ids(8), cellCount: 4 });
    act(() => result.current.clear(1));
    expect(result.current.assignment).toEqual(["c1", null, "c3", "c4"]);
  });

  it("moves through the groups with next and previous", () => {
    const { result } = setup({ cameraIds: ids(8), cellCount: 4 });
    act(() => result.current.next());
    expect(result.current.assignment).toEqual(["c5", "c6", "c7", "c8"]);
    act(() => result.current.next());
    expect(result.current.assignment).toEqual(["c1", "c2", "c3", "c4"]);
    act(() => result.current.previous());
    expect(result.current.assignment).toEqual(["c5", "c6", "c7", "c8"]);
  });
});

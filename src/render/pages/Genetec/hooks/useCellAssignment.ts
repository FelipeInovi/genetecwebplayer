import { useCallback, useState } from "react";
import {
  assignCamera,
  clearCell,
  nextGroup,
  previousGroup,
  resizeAssignment,
  type CellAssignment
} from "@/render/pages/Genetec/hooks/cellAssignment";

interface State {
  assignment: CellAssignment;
  cellCount: number;
  idsKey: string;
  selectedCell: number | null;
}

export interface UseCellAssignmentResult {
  assignment: CellAssignment;
  selectedCell: number | null;
  /** Selecting the selected cell again unselects it. */
  selectCell: (cellIndex: number | null) => void;
  assign: (cellIndex: number, cameraId: string) => void;
  /** Click-to-assign: puts the camera in the selected cell (no-op without one). */
  assignToSelected: (cameraId: string) => void;
  clear: (cellIndex: number) => void;
  next: () => void;
  previous: () => void;
}

/**
 * Which camera shows in which cell. The assignment is resized in the same
 * render in which the cell count or the catalog changes (no frame with a
 * stale length), keeping what the user picked.
 */
export const useCellAssignment = (
  cameraIds: string[],
  cellCount: number
): UseCellAssignmentResult => {
  const idsKey = cameraIds.join("\u0000");
  const [state, setState] = useState<State>(() => ({
    assignment: resizeAssignment([], cellCount, cameraIds),
    cellCount,
    idsKey,
    selectedCell: null
  }));

  let current = state;
  if (state.cellCount !== cellCount || state.idsKey !== idsKey) {
    current = {
      assignment: resizeAssignment(state.assignment, cellCount, cameraIds),
      cellCount,
      idsKey,
      selectedCell:
        state.selectedCell !== null && state.selectedCell < cellCount
          ? state.selectedCell
          : null
    };
    setState(current);
  }
  const update = useCallback(
    (change: (assignment: CellAssignment) => CellAssignment) =>
      setState((prev) => ({ ...prev, assignment: change(prev.assignment) })),
    []
  );

  const selectCell = useCallback(
    (cellIndex: number | null) =>
      setState((prev) => ({
        ...prev,
        selectedCell: prev.selectedCell === cellIndex ? null : cellIndex
      })),
    []
  );
  const assign = useCallback(
    (cellIndex: number, cameraId: string) =>
      update((a) => assignCamera(a, cellIndex, cameraId)),
    [update]
  );
  const assignToSelected = useCallback(
    (cameraId: string) =>
      setState((prev) =>
        prev.selectedCell === null
          ? prev
          : {
              ...prev,
              assignment: assignCamera(prev.assignment, prev.selectedCell, cameraId)
            }
      ),
    []
  );
  const clear = useCallback(
    (cellIndex: number) => update((a) => clearCell(a, cellIndex)),
    [update]
  );
  const next = useCallback(
    () => update((a) => nextGroup(a, cameraIds)),
    [update, cameraIds]
  );
  const previous = useCallback(
    () => update((a) => previousGroup(a, cameraIds)),
    [update, cameraIds]
  );

  return {
    assignment: current.assignment,
    selectedCell: current.selectedCell,
    selectCell,
    assign,
    assignToSelected,
    clear,
    next,
    previous
  };
};

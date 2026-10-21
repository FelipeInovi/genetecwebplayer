/**
 * Pure model of "which camera shows in which mosaic cell". The assignment has
 * one entry per cell (a camera id, or null for an empty cell); a camera is
 * never in two cells. Every function returns a new array (or the same one when
 * nothing changes, so React can skip the render).
 */
export type CellAssignment = Array<string | null>;

export interface AssignmentChange {
  cellIndex: number;
  cameraId: string;
  previousCameraId: string | null;
}

export interface GroupRange {
  /** 1-based position of the first camera in the catalog. */
  from: number;
  /** 1-based position of the last camera in the catalog. */
  to: number;
  total: number;
}

const emptyCells = (count: number): CellAssignment =>
  Array.from({ length: count }, () => null);

/** Cameras `[start, start + cellCount)` of the catalog; missing ones leave the cell empty. */
const groupAt = (
  cameraIds: string[],
  start: number,
  cellCount: number
): CellAssignment =>
  Array.from({ length: cellCount }, (_, i) => cameraIds[start + i] ?? null);

export const createAssignment = (
  cameraIds: string[],
  cellCount: number
): CellAssignment => groupAt(cameraIds, 0, cellCount);

/**
 * Keeps what is still valid (in the catalog, first occurrence only), truncates
 * to `cellCount` and fills every empty slot with the next camera that is not
 * displayed yet, in catalog order.
 */
export const resizeAssignment = (
  assignment: CellAssignment,
  cellCount: number,
  cameraIds: string[]
): CellAssignment => {
  const inCatalog = new Set(cameraIds);
  const used = new Set<string>();
  const kept: CellAssignment = emptyCells(cellCount).map((_, i) => {
    const id = assignment[i] ?? null;
    if (id === null || !inCatalog.has(id) || used.has(id)) return null;
    used.add(id);
    return id;
  });
  const free = cameraIds.filter((id) => !used.has(id));
  let next = 0;
  return kept.map((id) => id ?? free[next++] ?? null);
};

/** Puts `cameraId` in the cell. If it is displayed elsewhere, both cells swap. */
export const assignCamera = (
  assignment: CellAssignment,
  cellIndex: number,
  cameraId: string
): CellAssignment => {
  if (cellIndex < 0 || cellIndex >= assignment.length) return assignment;
  if (assignment[cellIndex] === cameraId) return assignment;
  const next = [...assignment];
  const source = assignment.indexOf(cameraId);
  if (source >= 0) next[source] = assignment[cellIndex];
  next[cellIndex] = cameraId;
  return next;
};

export const clearCell = (
  assignment: CellAssignment,
  cellIndex: number
): CellAssignment => {
  if (assignment[cellIndex] == null) return assignment;
  const next = [...assignment];
  next[cellIndex] = null;
  return next;
};

/**
 * Catalog index of the first camera of the group the assignment belongs to:
 * the first non-empty cell, shifted back by its position so a group with a
 * cleared cell keeps its alignment. 0 when nothing is assigned.
 */
const groupStart = (assignment: CellAssignment, cameraIds: string[]): number => {
  const cell = assignment.findIndex((id) => id !== null);
  if (cell < 0) return 0;
  const index = cameraIds.indexOf(assignment[cell] as string);
  return index < 0 ? 0 : Math.max(0, index - cell);
};

/**
 * Next group of cameras, wrapping around: 1-4 -> 5-8 ... 29-32 -> 1-4.
 * A catalog that is not a multiple of the cell count ends with a PARTIAL group
 * (e.g. 10 cameras, 4 cells: 9-10 and two empty cells) instead of repeating
 * cameras, so no camera shows twice and the label stays a plain range.
 */
export const nextGroup = (
  assignment: CellAssignment,
  cameraIds: string[]
): CellAssignment => {
  const cellCount = assignment.length;
  if (cameraIds.length === 0) return emptyCells(cellCount);
  const next = groupStart(assignment, cameraIds) + cellCount;
  return groupAt(cameraIds, next >= cameraIds.length ? 0 : next, cellCount);
};

export const previousGroup = (
  assignment: CellAssignment,
  cameraIds: string[]
): CellAssignment => {
  const cellCount = assignment.length;
  if (cameraIds.length === 0) return emptyCells(cellCount);
  const previous = groupStart(assignment, cameraIds) - cellCount;
  const lastStart = Math.floor((cameraIds.length - 1) / cellCount) * cellCount;
  return groupAt(cameraIds, previous < 0 ? lastStart : previous, cellCount);
};

/**
 * The catalog range shown when the assignment is a contiguous group (cells in
 * catalog order, only trailing cells empty); null for a custom selection.
 */
export const describeGroup = (
  assignment: CellAssignment,
  cameraIds: string[]
): GroupRange | null => {
  const shown = assignment.filter((id): id is string => id !== null);
  if (shown.length === 0) return null;
  if (assignment.slice(0, shown.length).some((id) => id === null)) return null;
  const start = cameraIds.indexOf(shown[0]);
  if (start < 0) return null;
  const contiguous = shown.every((id, i) => cameraIds[start + i] === id);
  if (!contiguous) return null;
  return { from: start + 1, to: start + shown.length, total: cameraIds.length };
};

/** Cells that now show a camera different from before (clears are not changes). */
export const diffAssignment = (
  previous: CellAssignment,
  next: CellAssignment
): AssignmentChange[] =>
  next.flatMap((cameraId, cellIndex) => {
    const previousCameraId = previous[cellIndex] ?? null;
    return cameraId !== null && cameraId !== previousCameraId
      ? [{ cellIndex, cameraId, previousCameraId }]
      : [];
  });

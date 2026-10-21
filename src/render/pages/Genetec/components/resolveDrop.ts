/** Payload attached to draggables (camera list items and filled mosaic cells). */
export interface DragData {
  type?: string;
  cameraId?: string;
}

/** Payload attached to droppables (mosaic cells). */
export interface DropData {
  type?: string;
  index?: number;
}

export interface DropResult {
  cellIndex: number;
  cameraId: string;
}

/**
 * What a drag-end means for the assignment: put `cameraId` in `cellIndex`
 * (dropping a displayed camera on another cell swaps them through
 * assignCamera). Null when the drop does nothing.
 */
export const resolveDrop = (
  active: DragData | undefined,
  over: DropData | undefined
): DropResult | null => {
  if (!active?.cameraId) return null;
  if (over?.type !== "mosaic-cell" || typeof over.index !== "number") return null;
  return { cellIndex: over.index, cameraId: active.cameraId };
};

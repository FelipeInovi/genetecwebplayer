const FIXED_COLUMNS: Record<number, number> = {
  1: 1,
  2: 2,
  4: 2,
  8: 4,
  16: 4,
  32: 8
};

/** Grid columns for a mosaic of `count` cells. */
export const getGridColumns = (count: number): number => {
  if (count <= 1) return 1;
  return FIXED_COLUMNS[count] ?? Math.ceil(Math.sqrt(count));
};

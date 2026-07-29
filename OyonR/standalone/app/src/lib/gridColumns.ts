/*
 * Symmetric grid columns.
 *
 * A metric grid with a hardcoded column count goes ragged the moment the tile
 * count stops being a multiple of it — 8 tiles in a 6-column grid renders as
 * 6 + 2 orphans. Deriving the column count from the tile count instead means
 * every row is full, and it stays that way when tiles are added or removed.
 *
 * Tailwind cannot compile dynamic class names, so the mapping is explicit.
 */

const COLS: Record<number, string> = {
  3: 'lg:grid-cols-3',
  4: 'lg:grid-cols-4',
  5: 'lg:grid-cols-5',
  6: 'lg:grid-cols-6',
};

/**
 * Largest column count in [3,6] that divides `count` exactly, preferring wider
 * rows. Prime counts (7, 11, 13…) have no such divisor at all — those fall back
 * to 4, which cannot be symmetric; the honest fix there is to change the number
 * of tiles, so this is a floor rather than a promise.
 */
export function symmetricColumns(count: number): string {
  if (count <= 0) return COLS[4];
  if (count <= 3) return COLS[3];
  for (const d of [6, 5, 4, 3]) {
    if (count % d === 0) return COLS[d];
  }
  return COLS[4];
}

/** Divisor behind {@link symmetricColumns} — exposed for tests. */
export function symmetricColumnCount(count: number): number {
  if (count <= 0) return 4;
  if (count <= 3) return 3;
  for (const d of [6, 5, 4, 3]) {
    if (count % d === 0) return d;
  }
  return 4;
}

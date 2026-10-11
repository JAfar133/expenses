import type { BreakdownRow } from '../api/analytics.api.ts';

/**
 * Category for the name breakdown: the requested one if it is in the list,
 * otherwise the biggest spend (the list is already sorted by amount). No categories: nothing to show.
 */
export function pickDrillCategory(
  requested: string | null,
  categories: BreakdownRow[],
): string | undefined {
  if (requested && categories.some((row) => row.key === requested)) return requested;
  return categories[0]?.key;
}

export interface NameShare {
  key: string;
  total: number;
  count: number;
  average: number;
  /** Share of the category amount, 0..1 */
  share: number;
  /** Bar length relative to the largest name, 0..1 */
  relative: number;
}

/** Name rows with shares in the category; `categoryTotal` is taken from the category breakdown. */
export function toNameShares(rows: BreakdownRow[], categoryTotal: number): NameShare[] {
  const largest = rows.reduce((max, row) => Math.max(max, row.total), 0);
  return rows.map((row) => ({
    ...row,
    share: categoryTotal > 0 ? row.total / categoryTotal : 0,
    relative: largest > 0 ? row.total / largest : 0,
  }));
}

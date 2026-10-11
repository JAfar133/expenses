import type { BreakdownRow, SeriesPoint } from '../api/analytics.api.ts';

/** How many slices to show in a pie chart: more is unreadable, the rest goes to "other". */
export const MAX_SLICES = 7;
/** Label of the merged tail. Not "Other" (the generic Russian word): such a category may exist for real, and they are easy to confuse. */
export const OTHER_KEY = 'Остальное';

export interface Slice {
  key: string;
  total: number;
  count: number;
  /** Share of the sum of all slices, 0..1 */
  share: number;
  /** Merged tail of the list */
  isOther: boolean;
  /** How many categories are merged into the tail (0 for ordinary slices) */
  merged: number;
}

/** The largest groups separately, the rest as one "other" slice. Input is sorted by amount. */
export function toSlices(rows: BreakdownRow[], max = MAX_SLICES): Slice[] {
  const grand = rows.reduce((sum, row) => sum + row.total, 0);
  if (grand === 0) return [];

  const share = (total: number) => total / grand;
  const keepAll = rows.length <= max;
  const head = keepAll ? rows : rows.slice(0, max - 1);
  const slices: Slice[] = head.map((row) => ({
    key: row.key,
    total: row.total,
    count: row.count,
    share: share(row.total),
    isOther: false,
    merged: 0,
  }));

  if (!keepAll) {
    const tail = rows.slice(max - 1);
    const total = tail.reduce((sum, row) => sum + row.total, 0);
    slices.push({
      key: OTHER_KEY,
      total,
      count: tail.reduce((sum, row) => sum + row.count, 0),
      share: share(total),
      isOther: true,
      merged: tail.length,
    });
  }
  return slices;
}

/** Running total over periods. */
export function cumulative(points: SeriesPoint[]): SeriesPoint[] {
  let running = 0;
  let count = 0;
  return points.map((point) => {
    running += point.total;
    count += point.count;
    return { ...point, total: running, count };
  });
}

/** By what percent the value grew relative to the previous one; null if there is nothing to compare with. */
export function changePercent(current: number, previous: number | undefined): number | null {
  if (previous === undefined || previous === 0) return null;
  return ((current - previous) / previous) * 100;
}

/** How many colors in the chart palette (categorical slots 1-7; the eighth slot is unused). */
export const SERIES_SLOTS = 7;

/**
 * A color belongs to a value, not a rank position: a group present in the `order` reference always gets the same slot.
 * Others get free slots in order; if slots run out, null is returned (neutral color).
 */
export function assignColors(keys: string[], order: string[]): Map<string, number | null> {
  const taken = new Set<number>();
  const result = new Map<string, number | null>();

  for (const key of keys) {
    const index = order.indexOf(key);
    if (index >= 0 && index < SERIES_SLOTS && !taken.has(index)) {
      result.set(key, index);
      taken.add(index);
    }
  }
  for (const key of keys) {
    if (result.has(key)) continue;
    let slot = 0;
    while (taken.has(slot) && slot < SERIES_SLOTS) slot++;
    result.set(key, slot < SERIES_SLOTS ? slot : null);
    if (slot < SERIES_SLOTS) taken.add(slot);
  }
  return result;
}

/** CSS color of a slot (variables are defined in index.css for light and dark themes). */
export const seriesColor = (slot: number | null | undefined) =>
  slot === null || slot === undefined ? 'var(--chart-other)' : `var(--series-${slot + 1})`;

/** Axis numbers: 1500 → "1,5K", 2 500 000 → "2,5M". */
export function compactNumber(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${trim(value / 1_000_000)}M`;
  if (abs >= 1_000) return `${trim(value / 1_000)}K`;
  // Small amounts (e.g. in dollars) can be fractional: up to two decimals, comma as the separator
  return String(Math.round(value * 100) / 100).replace('.', ',');
}

const trim = (value: number) => String(Math.round(value * 10) / 10).replace('.', ',');

import type { BreakdownRow } from '../api/analytics.api.ts';

/**
 * Категория для разбивки по наименованиям: запрошенная, если она есть в списке,
 * иначе самая затратная (список уже отсортирован по сумме). Нет категорий: нечего показывать.
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
  /** Доля от суммы категории, 0..1 */
  share: number;
  /** Длина полосы относительно самого крупного наименования, 0..1 */
  relative: number;
}

/** Строки наименований с долями в категории; `categoryTotal` берётся из разбивки по категориям. */
export function toNameShares(rows: BreakdownRow[], categoryTotal: number): NameShare[] {
  const largest = rows.reduce((max, row) => Math.max(max, row.total), 0);
  return rows.map((row) => ({
    ...row,
    share: categoryTotal > 0 ? row.total / categoryTotal : 0,
    relative: largest > 0 ? row.total / largest : 0,
  }));
}

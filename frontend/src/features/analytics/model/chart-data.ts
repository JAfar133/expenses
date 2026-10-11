import type { BreakdownRow, SeriesPoint } from '../api/analytics.api.ts';

/** Сколько секторов показываем в круговой диаграмме: больше не прочитать, остальное «другое». */
export const MAX_SLICES = 7;
export const OTHER_KEY = 'Другое';

export interface Slice {
  key: string;
  total: number;
  count: number;
  /** Доля от суммы всех секторов, 0..1 */
  share: number;
  /** Объединённый хвост списка */
  isOther: boolean;
}

/** Самые крупные группы отдельно, остальные одним сектором «Другое». Вход отсортирован по сумме. */
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
    });
  }
  return slices;
}

/** Нарастающий итог по периодам. */
export function cumulative(points: SeriesPoint[]): SeriesPoint[] {
  let running = 0;
  let count = 0;
  return points.map((point) => {
    running += point.total;
    count += point.count;
    return { ...point, total: running, count };
  });
}

/** На сколько процентов значение выросло относительно предыдущего; null, если сравнивать не с чем. */
export function changePercent(current: number, previous: number | undefined): number | null {
  if (previous === undefined || previous === 0) return null;
  return ((current - previous) / previous) * 100;
}

/** Сколько цветов в палитре графика (категориальные слоты 1–7; восьмой слот не используется). */
export const SERIES_SLOTS = 7;

/**
 * Цвет принадлежит значению, а не месту в рейтинге: группа, которая есть в справочнике `order`, всегда получает один и тот же слот.
 * Остальным достаются свободные слоты по порядку; если слотов не хватило, возвращается null (нейтральный цвет).
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

/** CSS-цвет слота (переменные заданы в index.css для светлой и тёмной темы). */
export const seriesColor = (slot: number | null | undefined) =>
  slot === null || slot === undefined ? 'var(--chart-other)' : `var(--series-${slot + 1})`;

/** Числа на осях: 1500 → «1,5K», 2 500 000 → «2,5M». */
export function compactNumber(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${trim(value / 1_000_000)}M`;
  if (abs >= 1_000) return `${trim(value / 1_000)}K`;
  return String(value);
}

const trim = (value: number) => String(Math.round(value * 10) / 10).replace('.', ',');

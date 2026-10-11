import type { BreakdownRow, SeriesPoint } from '../api/analytics.api.ts';
import { changePercent, OTHER_KEY } from './chart-data.ts';
import { daysInMonth, monthOf, type MonthKey } from './periods.ts';

export interface MonthRow {
  month: MonthKey;
  total: number;
  count: number;
  /** Сколько дней месяца прошло (для текущего месяца только до сегодня) */
  days: number;
  perDay: number;
  /** Изменение суммы к предыдущему месяцу списка, %; у первого и у незаконченного месяца null */
  change: number | null;
  /** Месяц ещё не закончился */
  partial: boolean;
}

/** Строки по месяцам из точек `timeseries` с шагом «месяц» (пропуски уже заполнены нулями). */
export function toMonthRows(points: SeriesPoint[], today: string): MonthRow[] {
  const currentMonth = monthOf(today);

  return points.map((point, index) => {
    const month = monthOf(point.period);
    const partial = month === currentMonth;
    const days = partial ? Number(today.slice(8, 10)) : daysInMonth(month);
    return {
      month,
      total: point.total,
      count: point.count,
      days,
      perDay: days > 0 ? point.total / days : 0,
      // Незаконченный месяц нельзя честно сравнивать с целым предыдущим
      change: index === 0 || partial ? null : changePercent(point.total, points[index - 1]!.total),
      partial,
    };
  });
}

/**
 * Средний расход за завершённый месяц. Считается с первого месяца, где есть расходы:
 * пустые месяцы до начала учёта среднее не занижают. Нужно хотя бы два завершённых месяца.
 */
export function averageOfCompleteMonths(rows: MonthRow[]): number | null {
  const firstWithSpending = rows.findIndex((row) => row.total > 0);
  if (firstWithSpending < 0) return null;

  const complete = rows.slice(firstWithSpending).filter((row) => !row.partial);
  if (complete.length < 2) return null;
  return complete.reduce((sum, row) => sum + row.total, 0) / complete.length;
}

export interface CategoryMatrix {
  months: MonthKey[];
  /** Крупнейшие категории по всему периоду, затем «Другое», если категорий больше лимита */
  categories: string[];
  /** Сумма по категории за месяц */
  rows: { month: MonthKey; values: Record<string, number> }[];
}

/** Месяцы × категории из точек `timeseries` с разбивкой по категории. */
export function toCategoryMatrix(
  points: SeriesPoint[],
  months: MonthKey[],
  maxCategories = 7,
): CategoryMatrix {
  const totals = new Map<string, number>();
  for (const point of points) {
    totals.set(point.key!, (totals.get(point.key!) ?? 0) + point.total);
  }
  const ranked = [...totals]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([key]) => key);

  const overflow = ranked.length > maxCategories;
  const kept = overflow ? ranked.slice(0, maxCategories - 1) : ranked;
  const keptSet = new Set(kept);

  const rows = months.map((month) => ({ month, values: {} as Record<string, number> }));
  const byMonth = new Map(rows.map((row) => [row.month, row]));

  for (const point of points) {
    const row = byMonth.get(monthOf(point.period));
    if (!row) continue;
    const key = keptSet.has(point.key!) ? point.key! : OTHER_KEY;
    row.values[key] = (row.values[key] ?? 0) + point.total;
  }

  return { months, categories: overflow ? [...kept, OTHER_KEY] : kept, rows };
}

export interface CategoryDifference {
  key: string;
  a: number;
  b: number;
  /** a − b: на сколько месяц A больше месяца B */
  difference: number;
  /** Изменение A к B в процентах; null, если в B ничего не было */
  change: number | null;
}

/** Сравнение двух месяцев по категориям; сначала самые заметные расхождения. */
export function compareCategories(a: BreakdownRow[], b: BreakdownRow[]): CategoryDifference[] {
  const totalsA = new Map(a.map((row) => [row.key, row.total]));
  const totalsB = new Map(b.map((row) => [row.key, row.total]));
  const keys = new Set([...totalsA.keys(), ...totalsB.keys()]);

  return [...keys]
    .map((key) => {
      const valueA = totalsA.get(key) ?? 0;
      const valueB = totalsB.get(key) ?? 0;
      return {
        key,
        a: valueA,
        b: valueB,
        difference: valueA - valueB,
        change: changePercent(valueA, valueB),
      };
    })
    .sort((x, y) => Math.abs(y.difference) - Math.abs(x.difference) || x.key.localeCompare(y.key));
}

export type SortDirection = 'asc' | 'desc';

/** Сортировка небольшой таблицы по числовому или текстовому столбцу; пустые значения в конце. */
export function sortRows<T>(
  rows: T[],
  value: (row: T) => number | string | null,
  direction: SortDirection,
): T[] {
  const sign = direction === 'asc' ? 1 : -1;
  return [...rows].sort((x, y) => {
    const [vx, vy] = [value(x), value(y)];
    if (vx === null && vy === null) return 0;
    if (vx === null) return 1;
    if (vy === null) return -1;
    if (typeof vx === 'number' && typeof vy === 'number') return (vx - vy) * sign;
    return String(vx).localeCompare(String(vy), 'ru') * sign;
  });
}

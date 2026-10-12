import { crossRate, currencyDigits } from '../../../shared/utils/conversion.ts';
import type {
  BreakdownRow,
  PeriodSummary,
  SeriesPoint,
  SummaryResult,
} from '../api/analytics.api.ts';

export { currencyLabel, flagOf } from '../../../shared/utils/currency-flags.ts';

/** How many decimals to show for an amount: drams (the pivot currency) are whole, other currencies have cents. */
export const moneyDigits = (code: string, pivot = 'AMD') => currencyDigits(code, pivot);

/**
 * Multiplier for converting an amount from the reporting currency to the selected one:
 * rate(reporting) / rate(code), where a rate is the price of a currency unit in drams (the pivot, its rate is 1).
 * An unknown or invalid rate leaves the amount as is.
 */
export function scaleFactor(
  code: string,
  reporting: string,
  rates: { currency: string; rate: number }[] | undefined,
  pivot = 'AMD',
): number {
  if (code === reporting) return 1;
  return crossRate(rates, reporting, code, pivot) ?? 1;
}

/** Rounds to the decimals of the display currency (a no-op without `digits`). */
const roundTo = (value: number, digits?: number) =>
  digits === undefined ? value : Number(value.toFixed(digits));

const scalePeriod = (period: PeriodSummary, factor: number, digits?: number): PeriodSummary => ({
  ...period,
  total: roundTo(period.total * factor, digits),
  average: roundTo(period.average * factor, digits),
  median: roundTo(period.median * factor, digits),
  max: roundTo(period.max * factor, digits),
  perDay: roundTo(period.perDay * factor, digits),
});

/** Metrics in another currency. Counts, days and dates do not change. */
export function scaleSummary(
  summary: SummaryResult,
  factor: number,
  digits?: number,
): SummaryResult {
  if (factor === 1) return summary;
  return {
    current: scalePeriod(summary.current, factor, digits),
    previous: summary.previous && scalePeriod(summary.previous, factor, digits),
  };
}

export function scaleSeries(points: SeriesPoint[], factor: number, digits?: number): SeriesPoint[] {
  if (factor === 1) return points;
  return points.map((point) => ({ ...point, total: roundTo(point.total * factor, digits) }));
}

export function scaleBreakdown(
  rows: BreakdownRow[],
  factor: number,
  digits?: number,
): BreakdownRow[] {
  if (factor === 1) return rows;
  return rows.map((row) => ({
    ...row,
    total: roundTo(row.total * factor, digits),
    average: roundTo(row.average * factor, digits),
  }));
}

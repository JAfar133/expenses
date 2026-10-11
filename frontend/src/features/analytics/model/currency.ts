import type {
  BreakdownRow,
  PeriodSummary,
  SeriesPoint,
  SummaryResult,
} from '../api/analytics.api.ts';

export { currencyLabel, flagOf } from '../../../shared/utils/currency-flags.ts';

/** How many decimals to show for an amount: drams are whole, other currencies have cents. */
export const moneyDigits = (code: string, base: string) => (code === base ? 0 : 2);

/**
 * Multiplier for converting from the base currency (drams) to the selected one: amount / rate.
 * The rate is how many drams a unit of currency costs; for the base currency and a currency without a rate the multiplier is 1.
 */
export function scaleFactor(
  code: string,
  base: string,
  rates: { currency: string; rate: number }[] | undefined,
): number {
  if (code === base) return 1;
  const rate = rates?.find((item) => item.currency === code)?.rate;
  return rate && rate > 0 ? 1 / rate : 1;
}

const scalePeriod = (period: PeriodSummary, factor: number): PeriodSummary => ({
  ...period,
  total: period.total * factor,
  average: period.average * factor,
  median: period.median * factor,
  max: period.max * factor,
  perDay: period.perDay * factor,
});

/** Metrics in another currency. Counts, days and dates do not change. */
export function scaleSummary(summary: SummaryResult, factor: number): SummaryResult {
  if (factor === 1) return summary;
  return {
    current: scalePeriod(summary.current, factor),
    previous: summary.previous && scalePeriod(summary.previous, factor),
  };
}

export function scaleSeries(points: SeriesPoint[], factor: number): SeriesPoint[] {
  if (factor === 1) return points;
  return points.map((point) => ({ ...point, total: point.total * factor }));
}

export function scaleBreakdown(rows: BreakdownRow[], factor: number): BreakdownRow[] {
  if (factor === 1) return rows;
  return rows.map((row) => ({ ...row, total: row.total * factor, average: row.average * factor }));
}

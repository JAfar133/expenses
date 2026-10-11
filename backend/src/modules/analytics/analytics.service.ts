import { addDays, daysInclusive, nextPeriod, periodStart } from './date-math.ts';
import type { AnalyticsRepository } from './analytics.repository.ts';
import type {
  AnalyticsFilters,
  Author,
  BreakdownBy,
  BreakdownRow,
  ExpenseListPage,
  Granularity,
  ListOptions,
  SeriesPoint,
  SeriesSplit,
  SummaryStats,
} from './analytics.types.ts';

export interface PeriodSummary extends SummaryStats {
  /** How many days of the period have passed (up to today): daily spending is computed from them */
  days: number;
  /** Average spending per day over the elapsed days of the period */
  perDay: number;
}

export interface SummaryResult {
  current: PeriodSummary;
  /** Previous period of the same length; only if both period bounds are set */
  previous: PeriodSummary | null;
}

export interface AnalyticsServiceOptions {
  repository: Pick<
    AnalyticsRepository,
    'summary' | 'breakdown' | 'timeseries' | 'list' | 'authors'
  >;
  /** Today's date in the user's time zone (YYYY-MM-DD) */
  today: (timezone: string) => string;
}

/** Metrics, charts and lists for the analytics page. */
export class AnalyticsService {
  constructor(private readonly options: AnalyticsServiceOptions) {}

  async summary(filters: AnalyticsFilters, timezone = 'UTC'): Promise<SummaryResult> {
    const today = this.options.today(timezone);
    const stats = await this.options.repository.summary(filters);
    const current = withPerDay(stats, elapsedDays(filters, stats, today));

    // We compare with the same number of days before the period start: for the current month it is the same stretch of the previous one
    const length = elapsedDays(filters, stats, today);
    if (!filters.from || !filters.to || length === 0) return { current, previous: null };

    const previousTo = addDays(filters.from, -1);
    const previousFilters = {
      ...filters,
      from: addDays(previousTo, -(length - 1)),
      to: previousTo,
    };
    const previousStats = await this.options.repository.summary(previousFilters);
    return { current, previous: withPerDay(previousStats, length) };
  }

  breakdown(filters: AnalyticsFilters, by: BreakdownBy, limit: number): Promise<BreakdownRow[]> {
    return this.options.repository.breakdown(filters, by, limit);
  }

  /**
   * Sums by period. Without a breakdown, missing periods are filled with zeros so the chart has no gaps;
   * future days are not added.
   */
  async timeseries(
    filters: AnalyticsFilters,
    granularity: Granularity,
    splitBy?: SeriesSplit,
    timezone = 'UTC',
  ): Promise<SeriesPoint[]> {
    const points = await this.options.repository.timeseries(filters, granularity, splitBy);
    // Without a breakdown and without a known period there is nothing to fill with
    const noRange = points.length === 0 && !(filters.from && filters.to);
    if (splitBy || noRange) return points;

    const today = this.options.today(timezone);
    const first = filters.from ?? points[0]!.period;
    const lastWanted = filters.to ?? points[points.length - 1]!.period;
    const last = lastWanted > today ? today : lastWanted;
    return fillGaps(points, periodStart(first, granularity), last, granularity);
  }

  authors(): Promise<Author[]> {
    return this.options.repository.authors();
  }

  list(filters: AnalyticsFilters, options: ListOptions): Promise<ExpenseListPage> {
    return this.options.repository.list(filters, options);
  }
}

/** How many days of the period have passed by today (without future days). */
function elapsedDays(filters: AnalyticsFilters, stats: SummaryStats, today: string): number {
  const from = filters.from ?? stats.firstDate;
  if (!from) return 0;
  const to = filters.to && filters.to < today ? filters.to : today;
  return daysInclusive(from, to);
}

const withPerDay = (stats: SummaryStats, days: number): PeriodSummary => ({
  ...stats,
  days,
  perDay: days > 0 ? stats.total / days : 0,
});

function fillGaps(
  points: SeriesPoint[],
  firstPeriod: string,
  lastDate: string,
  granularity: Granularity,
): SeriesPoint[] {
  const byPeriod = new Map(points.map((point) => [point.period, point]));
  const filled: SeriesPoint[] = [];
  for (let period = firstPeriod; period <= lastDate; period = nextPeriod(period, granularity)) {
    filled.push(byPeriod.get(period) ?? { period, total: 0, count: 0 });
  }
  return filled;
}

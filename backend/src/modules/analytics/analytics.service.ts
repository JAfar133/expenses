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
  /** Сколько дней периода прошло (до сегодня): по ним считается расход в день */
  days: number;
  /** Средний расход в день за прошедшие дни периода */
  perDay: number;
}

export interface SummaryResult {
  current: PeriodSummary;
  /** Предыдущий период такой же длины; только если заданы обе границы периода */
  previous: PeriodSummary | null;
}

export interface AnalyticsServiceOptions {
  repository: Pick<
    AnalyticsRepository,
    'summary' | 'breakdown' | 'timeseries' | 'list' | 'authors'
  >;
  /** Сегодняшняя дата в часовом поясе пользователя (YYYY-MM-DD) */
  today: (timezone: string) => string;
}

/** Показатели, графики и списки для страницы анализа. */
export class AnalyticsService {
  constructor(private readonly options: AnalyticsServiceOptions) {}

  async summary(filters: AnalyticsFilters, timezone = 'UTC'): Promise<SummaryResult> {
    const today = this.options.today(timezone);
    const stats = await this.options.repository.summary(filters);
    const current = withPerDay(stats, elapsedDays(filters, stats, today));

    // Сравниваем с таким же числом дней перед началом периода: для текущего месяца это тот же отрезок прошлого
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
   * Суммы по периодам. Без разбивки пропущенные периоды заполняются нулями, чтобы на графике не было дыр;
   * будущие дни не добавляются.
   */
  async timeseries(
    filters: AnalyticsFilters,
    granularity: Granularity,
    splitBy?: SeriesSplit,
    timezone = 'UTC',
  ): Promise<SeriesPoint[]> {
    const points = await this.options.repository.timeseries(filters, granularity, splitBy);
    // Без разбивки и без известного периода заполнять нечем
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

/** Сколько дней периода прошло к сегодняшнему дню (без будущих дней). */
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

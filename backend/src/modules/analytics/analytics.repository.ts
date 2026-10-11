import type { Database } from '../../infrastructure/database/database.ts';
import { dateText, timestampText } from '../../infrastructure/database/sql.ts';
import { buildWhere } from './analytics.query.ts';
import type {
  AnalyticsFilters,
  Author,
  BreakdownBy,
  BreakdownRow,
  ExpenseListItem,
  ExpenseListPage,
  Granularity,
  ListOptions,
  SeriesPoint,
  SeriesSplit,
  SortColumn,
  SummaryStats,
} from './analytics.types.ts';

/** Колонки сортировки: только из этого списка, в запрос попадают готовые фрагменты, а не ввод пользователя. */
const SORT_SQL: Record<SortColumn, string> = {
  date: 'date',
  card: 'card',
  category: 'category',
  name: 'lower(name)',
  amount: 'amount',
  createdBy: 'created_by',
};

/** Выражение группировки для каждого разреза. Валюта расхода в драммах это базовая валюта. */
const GROUP_SQL: Record<Exclude<BreakdownBy, 'currency'>, string> = {
  category: 'category',
  card: 'card',
  // Регистр и пробелы по краям не различаем; показываем написание из самой свежей записи
  name: 'lower(btrim(name))',
  weekday: 'EXTRACT(ISODOW FROM date)::int',
  createdBy: 'created_by',
};

const SPLIT_SQL: Record<SeriesSplit, string> = { category: 'category', card: 'card' };

const GRANULARITY_SQL: Record<Granularity, string> = {
  day: 'date',
  week: "date_trunc('week', date)::date",
  month: "date_trunc('month', date)::date",
};

interface SummaryRow {
  total: number;
  count: number;
  average: number;
  median: number;
  max: number;
  active_days: number;
  first_date: string | null;
  last_date: string | null;
}

/** Агрегаты и списки для страницы анализа. Все подсчёты выполняет SQL, наружу идут только готовые числа. */
export class AnalyticsRepository {
  constructor(
    private readonly database: Database,
    /** Базовая валюта: так отмечены расходы без исходной суммы */
    private readonly baseCurrency: string,
  ) {}

  async summary(filters: AnalyticsFilters): Promise<SummaryStats> {
    const where = buildWhere(filters, this.baseCurrency);
    const [row] = await this.database.query<SummaryRow>(
      `SELECT COALESCE(sum(amount), 0)::float8 AS total,
              count(*)::int AS count,
              COALESCE(avg(amount), 0)::float8 AS average,
              COALESCE(percentile_cont(0.5) WITHIN GROUP (ORDER BY amount), 0)::float8 AS median,
              COALESCE(max(amount), 0)::int AS max,
              count(DISTINCT date)::int AS active_days,
              ${dateText('min(date)')} AS first_date,
              ${dateText('max(date)')} AS last_date
         FROM expenses ${where.sql}`,
      where.params,
    );
    return {
      total: row!.total,
      count: row!.count,
      average: row!.average,
      median: row!.median,
      max: row!.max,
      activeDays: row!.active_days,
      firstDate: row!.first_date,
      lastDate: row!.last_date,
    };
  }

  async breakdown(
    filters: AnalyticsFilters,
    by: BreakdownBy,
    limit: number,
  ): Promise<BreakdownRow[]> {
    const where = buildWhere(filters, this.baseCurrency);
    const params = [...where.params];
    let keyExpression: string;
    let groupExpression: string;

    if (by === 'currency') {
      params.push(this.baseCurrency);
      groupExpression = `COALESCE(original_currency, $${params.length})`;
      keyExpression = groupExpression;
    } else {
      groupExpression = GROUP_SQL[by];
      keyExpression =
        by === 'name' ? '(array_agg(name ORDER BY seq DESC))[1]' : `${groupExpression}::text`;
    }

    params.push(limit);
    const rows = await this.database.query<{
      key: string;
      total: number;
      count: number;
      average: number;
    }>(
      `SELECT ${keyExpression} AS key,
              sum(amount)::float8 AS total,
              count(*)::int AS count,
              avg(amount)::float8 AS average
         FROM expenses ${where.sql}
        GROUP BY ${groupExpression}
        ORDER BY sum(amount) DESC, 1
        LIMIT $${params.length}`,
      params,
    );
    return rows.map(({ key, total, count, average }) => ({ key, total, count, average }));
  }

  async timeseries(
    filters: AnalyticsFilters,
    granularity: Granularity,
    splitBy?: SeriesSplit,
  ): Promise<SeriesPoint[]> {
    const where = buildWhere(filters, this.baseCurrency);
    const period = GRANULARITY_SQL[granularity];
    const split = splitBy ? `, ${SPLIT_SQL[splitBy]} AS key` : '';
    const groupSplit = splitBy ? `, ${SPLIT_SQL[splitBy]}` : '';

    const rows = await this.database.query<{
      period: string;
      key?: string;
      total: number;
      count: number;
    }>(
      `SELECT ${dateText(period)} AS period${split},
              sum(amount)::float8 AS total,
              count(*)::int AS count
         FROM expenses ${where.sql}
        GROUP BY ${period}${groupSplit}
        ORDER BY ${period}${groupSplit}`,
      where.params,
    );
    return rows.map((row) =>
      row.key === undefined
        ? { period: row.period, total: row.total, count: row.count }
        : { period: row.period, key: row.key, total: row.total, count: row.count },
    );
  }

  /** Авторы расходов (без удалённых) от самых активных; записи, пришедшие из Excel, подписаны «Из Excel». */
  async authors(): Promise<Author[]> {
    return this.database.query<Author>(
      `SELECT e.created_by AS value,
              COALESCE(u.display_name, CASE WHEN e.created_by = 'excel' THEN 'Из Excel' ELSE e.created_by END) AS label,
              count(*)::int AS count
         FROM expenses e
         LEFT JOIN users u ON u.username = e.created_by
        WHERE e.deleted_at IS NULL
        GROUP BY e.created_by, u.display_name
        ORDER BY count(*) DESC, e.created_by`,
    );
  }

  async list(filters: AnalyticsFilters, options: ListOptions): Promise<ExpenseListPage> {
    const where = buildWhere(filters, this.baseCurrency);
    const direction = options.direction === 'asc' ? 'ASC' : 'DESC';
    const params = [...where.params, options.limit, options.offset];

    const [items, [totals]] = await Promise.all([
      this.database.query<ListRow>(
        `SELECT id, ${dateText('date')} AS date, card, category, name, amount, source,
                excel_status, created_by, ${timestampText('deleted_at')} AS deleted_at,
                original_amount::float8 AS original_amount, original_currency,
                exchange_rate::float8 AS exchange_rate
           FROM expenses ${where.sql}
          ORDER BY ${SORT_SQL[options.sort]} ${direction}, seq ${direction}
          LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params,
      ),
      this.database.query<{ total: number; total_amount: number }>(
        `SELECT count(*)::int AS total, COALESCE(sum(amount), 0)::float8 AS total_amount
           FROM expenses ${where.sql}`,
        where.params,
      ),
    ]);

    return {
      items: items.map((row) => toListItem(row, this.baseCurrency)),
      total: totals!.total,
      totalAmount: totals!.total_amount,
    };
  }
}

interface ListRow {
  id: string;
  date: string;
  card: string;
  category: string;
  name: string;
  amount: number;
  source: 'app' | 'excel';
  excel_status: 'pending' | 'writing' | 'synced';
  created_by: string;
  deleted_at: string | null;
  original_amount: number | null;
  original_currency: string | null;
  exchange_rate: number | null;
}

/** Пустая валюта (`original_currency IS NULL`) означает базовую: расход введён в драммах или пришёл из Excel. */
const toListItem = (row: ListRow, baseCurrency: string): ExpenseListItem => ({
  id: row.id,
  date: row.date,
  card: row.card,
  category: row.category,
  name: row.name,
  amount: row.amount,
  currency: row.original_currency ?? baseCurrency,
  original:
    row.original_amount === null
      ? null
      : {
          amount: row.original_amount,
          currency: row.original_currency!,
          rate: row.exchange_rate!,
        },
  createdBy: row.created_by,
  source: row.source,
  excelStatus: row.excel_status,
  deletedAt: row.deleted_at,
});

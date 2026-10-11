/** Общие фильтры страницы анализа. Пустой список означает «без ограничения». */
export interface AnalyticsFilters {
  /** Границы периода включительно, YYYY-MM-DD */
  from?: string;
  to?: string;
  cards: string[];
  categories: string[];
  /** Логины пользователей, добавивших расход */
  createdBy: string[];
  /** Валюта ввода расхода; расход в драммах это базовая валюта */
  currencies: string[];
  /** Часть наименования, без учёта регистра */
  q?: string;
  minAmount?: number;
  maxAmount?: number;
  includeDeleted: boolean;
}

export interface SummaryStats {
  total: number;
  count: number;
  average: number;
  median: number;
  max: number;
  /** Сколько разных дней с расходами */
  activeDays: number;
  firstDate: string | null;
  lastDate: string | null;
}

export const BREAKDOWN_DIMENSIONS = [
  'category',
  'card',
  'name',
  'weekday',
  'currency',
  'createdBy',
] as const;
export type BreakdownBy = (typeof BREAKDOWN_DIMENSIONS)[number];

export interface BreakdownRow {
  /** Значение группы; для дня недели номер 1 (понедельник) … 7 (воскресенье) */
  key: string;
  total: number;
  count: number;
  average: number;
}

export const GRANULARITIES = ['day', 'week', 'month'] as const;
export type Granularity = (typeof GRANULARITIES)[number];

export const SERIES_SPLITS = ['category', 'card'] as const;
export type SeriesSplit = (typeof SERIES_SPLITS)[number];

export interface SeriesPoint {
  /** Первый день периода, YYYY-MM-DD */
  period: string;
  /** Значение разбивки (категория или карта); нет, если разбивки нет */
  key?: string;
  total: number;
  count: number;
}

export const SORT_COLUMNS = ['date', 'card', 'category', 'name', 'amount', 'createdBy'] as const;
export type SortColumn = (typeof SORT_COLUMNS)[number];
export type SortDirection = 'asc' | 'desc';

export interface ListOptions {
  sort: SortColumn;
  direction: SortDirection;
  limit: number;
  offset: number;
}

export interface ExpenseListItem {
  id: string;
  date: string;
  card: string;
  category: string;
  name: string;
  /** Сумма в драммах */
  amount: number;
  /** Валюта ввода; у расходов без исходной суммы (original_currency пусто) это базовая валюта */
  currency: string;
  original: { amount: number; currency: string; rate: number } | null;
  createdBy: string;
  source: 'app' | 'excel';
  excelStatus: 'pending' | 'writing' | 'synced';
  deletedAt: string | null;
}

/** Кто добавлял расходы: логин для фильтра и имя для показа. */
export interface Author {
  value: string;
  label: string;
  count: number;
}

export interface ExpenseListPage {
  items: ExpenseListItem[];
  /** Всего записей по фильтрам (для страниц) и их сумма */
  total: number;
  totalAmount: number;
}

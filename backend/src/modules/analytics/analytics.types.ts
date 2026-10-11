import type { ExcelState } from '../../storage/excel-state.ts';

/** Common filters of the analytics page. An empty list means "no restriction". */
export interface AnalyticsFilters {
  /** Period bounds, inclusive, YYYY-MM-DD */
  from?: string;
  to?: string;
  cards: string[];
  categories: string[];
  /** Logins of the users who added the expense */
  createdBy: string[];
  /** Expense entry currency; a dram expense is the base currency */
  currencies: string[];
  /** Part of the name, case-insensitive */
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
  /** How many distinct days have expenses */
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
  /** Group value; for the day of week the number 1 (Monday) … 7 (Sunday) */
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
  /** First day of the period, YYYY-MM-DD */
  period: string;
  /** Breakdown value (category or card); absent if there is no breakdown */
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
  /** Amount in drams */
  amount: number;
  /** Entry currency; for expenses without an original amount (original_currency is empty) it is the base currency */
  currency: string;
  original: { amount: number; currency: string; rate: number } | null;
  createdBy: string;
  source: 'app' | 'excel';
  excelStatus: 'pending' | 'writing' | 'synced';
  /** How the record relates to the Excel row: identical, waiting for a write, update or removal */
  excelState: ExcelState;
  /** Reason for the delay of the Excel write (the last error), if there was one */
  excelError: string | null;
  deletedAt: string | null;
  deletedReason: 'excel' | 'app' | null;
  updatedBy: string | null;
}

/** Who added expenses: login for the filter and name for display. */
export interface Author {
  value: string;
  label: string;
  count: number;
}

export interface ExpenseListPage {
  items: ExpenseListItem[];
  /** Total records matching the filters (for paging) and their sum */
  total: number;
  totalAmount: number;
}

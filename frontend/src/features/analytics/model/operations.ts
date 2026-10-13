import type { ExcelState, SortColumn, SortDirection } from '../api/operations.api.ts';

export interface ExcelStateInfo {
  /** Short label in the table */
  label: string;
  /** Detailed explanation */
  hint: string;
  /** How to highlight: all fine, waiting in the queue, or the record is no longer in Excel */
  tone: 'ok' | 'queued' | 'gone';
}

/** What to tell the user about a record: whether it matches Excel and whether sync went through. */
export const EXCEL_STATES: Record<ExcelState, ExcelStateInfo> = {
  synced: {
    label: 'Совпадает с Excel',
    hint: 'Строка в Excel идентична записи, синхронизация прошла',
    tone: 'ok',
  },
  'pending-add': {
    label: 'В очереди: нет в Excel',
    hint: 'Записи ещё нет в Excel, она ждёт в очереди на добавление',
    tone: 'queued',
  },
  'pending-update': {
    label: 'Отличается от Excel',
    hint: 'Запись исправлена, в Excel пока прежняя строка. Обновление ждёт в очереди',
    tone: 'queued',
  },
  'pending-remove': {
    label: 'В очереди: удалить из Excel',
    hint: 'Запись удалена, но её строка ещё в Excel. Удаление ждёт в очереди',
    tone: 'queued',
  },
  removed: {
    label: 'Удалена, из Excel убрана',
    hint: 'Запись удалена в приложении, её строка убрана из Excel',
    tone: 'gone',
  },
  missing: {
    label: 'Удалена: строки нет в Excel',
    hint: 'Запись удалена, потому что её строку убрали в самом Excel',
    tone: 'gone',
  },
};

/** Reasons why a record waits in the queue. */
const QUEUE_REASONS: Record<string, string> = {
  FILE_LOCKED: 'файл открыт в Excel',
  VERSION_CONFLICT: 'файл изменился во время записи',
  NETWORK: 'нет связи с OneDrive',
  TIMEOUT: 'OneDrive не ответил вовремя',
  AUTH_FAILED: 'нет доступа к OneDrive (нужна авторизация rclone)',
  ACCESS_DENIED: 'нет доступа к файлу',
  FILE_NOT_FOUND: 'файл Excel не найден',
  RATE_LIMITED: 'OneDrive просит подождать',
};

export function queueReason(code: string | null): string | null {
  if (!code) return null;
  return QUEUE_REASONS[code] ?? `ошибка ${code}`;
}

/** A word in parentheses for "queued" states: why the record is not in Excel yet. */
export function describeQueued(state: ExcelState, error: string | null): string | null {
  return EXCEL_STATES[state].tone === 'queued' ? queueReason(error) : null;
}

export const TEXT_COLUMNS: SortColumn[] = ['card', 'category', 'name', 'createdBy'];

/** New sort on header click: the same column flips direction, a new one starts with its natural direction. */
export function nextSort(
  current: { sort: SortColumn; direction: SortDirection },
  column: SortColumn,
): { sort: SortColumn; direction: SortDirection } {
  if (current.sort === column) {
    return { sort: column, direction: current.direction === 'asc' ? 'desc' : 'asc' };
  }
  return { sort: column, direction: TEXT_COLUMNS.includes(column) ? 'asc' : 'desc' };
}

export const PAGE_SIZE = 50;

export const pageCount = (total: number, size = PAGE_SIZE) => Math.max(1, Math.ceil(total / size));

/** Page from the URL, coerced to a valid one. */
export function clampPage(requested: number, total: number, size = PAGE_SIZE): number {
  if (!Number.isInteger(requested) || requested < 1) return 1;
  return Math.min(requested, pageCount(total, size));
}

/** "1-50 of 120" for the line under the table. */
export function rangeLabel(page: number, total: number, size = PAGE_SIZE): string {
  if (total === 0) return '0 записей';
  const from = (page - 1) * size + 1;
  const to = Math.min(page * size, total);
  return `${from}–${to} из ${total}`;
}

const DEFAULT_SORT = { sort: 'date' as SortColumn, direction: 'desc' as SortDirection };

/** Sorting from the URL: only known values, otherwise by date, newest first. */
export function parseSort(sort: string | null, dir: string | null) {
  const column = (['date', 'card', 'category', 'name', 'amount', 'createdBy'] as const).find(
    (value) => value === sort,
  );
  if (!column) return DEFAULT_SORT;
  return { sort: column, direction: dir === 'asc' ? ('asc' as const) : ('desc' as const) };
}

/** «1 запись», «3 записи», «68 записей». */
export function recordsLabel(count: number): string {
  const lastTwo = count % 100;
  const last = count % 10;
  if (lastTwo >= 11 && lastTwo <= 14) return `${count} записей`;
  if (last === 1) return `${count} запись`;
  if (last >= 2 && last <= 4) return `${count} записи`;
  return `${count} записей`;
}

/** Only for display: «кафе» → «Кафе». */
export const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

const MONTHS_GENITIVE = [
  'января',
  'февраля',
  'марта',
  'апреля',
  'мая',
  'июня',
  'июля',
  'августа',
  'сентября',
  'октября',
  'ноября',
  'декабря',
];

/** «13 октября 2026» for YYYY-MM-DD. */
export const dayWords = (iso: string) =>
  `${Number(iso.slice(8, 10))} ${MONTHS_GENITIVE[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;

/** Consecutive records of one date (the list is sorted by date, so a day is one run). */
export function groupByDate<T extends { date: string }>(
  items: T[],
): { date: string; items: T[] }[] {
  const groups: { date: string; items: T[] }[] = [];
  for (const item of items) {
    const last = groups.at(-1);
    if (last && last.date === item.date) last.items.push(item);
    else groups.push({ date: item.date, items: [item] });
  }
  return groups;
}

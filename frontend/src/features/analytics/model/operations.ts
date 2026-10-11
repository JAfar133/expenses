import type { ExcelState, SortColumn, SortDirection } from '../api/operations.api.ts';

export interface ExcelStateInfo {
  /** Короткая подпись в таблице */
  label: string;
  /** Подробное пояснение */
  hint: string;
  /** Как выделять: всё в порядке, ждёт в очереди или записи уже нет в Excel */
  tone: 'ok' | 'queued' | 'gone';
}

/** Что сказать пользователю о записи: совпадает ли она с Excel и дошла ли синхронизация. */
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

/** Причины, по которым запись ждёт в очереди. */
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

/** Слово в круглых скобках для состояний «в очереди»: почему запись ещё не в Excel. */
export function describeQueued(state: ExcelState, error: string | null): string | null {
  return EXCEL_STATES[state].tone === 'queued' ? queueReason(error) : null;
}

export const TEXT_COLUMNS: SortColumn[] = ['card', 'category', 'name', 'createdBy'];

/** Новая сортировка при нажатии на заголовок: тот же столбец меняет направление, новый начинает с естественного. */
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

/** Страница из адреса, приведённая к допустимой. */
export function clampPage(requested: number, total: number, size = PAGE_SIZE): number {
  if (!Number.isInteger(requested) || requested < 1) return 1;
  return Math.min(requested, pageCount(total, size));
}

/** «1–50 из 120» для строки под таблицей. */
export function rangeLabel(page: number, total: number, size = PAGE_SIZE): string {
  if (total === 0) return '0 записей';
  const from = (page - 1) * size + 1;
  const to = Math.min(page * size, total);
  return `${from}–${to} из ${total}`;
}

const DEFAULT_SORT = { sort: 'date' as SortColumn, direction: 'desc' as SortDirection };

/** Сортировка из адреса: только известные значения, иначе по дате от новых к старым. */
export function parseSort(sort: string | null, dir: string | null) {
  const column = (['date', 'card', 'category', 'name', 'amount', 'createdBy'] as const).find(
    (value) => value === sort,
  );
  if (!column) return DEFAULT_SORT;
  return { sort: column, direction: dir === 'asc' ? ('asc' as const) : ('desc' as const) };
}

import type { DeletedReason, Expense } from './expense.repository.ts';

/**
 * Как запись соотносится со строкой в Excel:
 *   synced          строка в Excel идентична записи, синхронизация прошла
 *   pending-add     записи в Excel ещё нет, она ждёт в очереди на добавление
 *   pending-update  запись исправлена, строка в Excel прежняя: ждёт обновления
 *   pending-remove  запись удалена, но её строка ещё в Excel: ждёт удаления
 *   removed         запись удалена в приложении, строка из Excel убрана
 *   missing         запись удалена, потому что её строку убрали в самом Excel
 */
export type ExcelState =
  'synced' | 'pending-add' | 'pending-update' | 'pending-remove' | 'removed' | 'missing';

export interface ExcelStateInput extends Expense {
  deletedAt: string | null;
  deletedReason: DeletedReason | null;
  excelSnapshot: Expense | null;
}

const sameValues = (a: Expense, b: Expense) =>
  a.date === b.date &&
  a.card === b.card &&
  a.category === b.category &&
  a.name === b.name &&
  a.amount === b.amount;

/** Состояние записи относительно Excel; выводится из самой записи и снимка строки. */
export function describeExcelState(row: ExcelStateInput): ExcelState {
  if (row.deletedAt !== null) {
    if (row.excelSnapshot !== null) return 'pending-remove';
    return row.deletedReason === 'excel' ? 'missing' : 'removed';
  }
  if (row.excelSnapshot === null) return 'pending-add';
  return sameValues(row, row.excelSnapshot) ? 'synced' : 'pending-update';
}

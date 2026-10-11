import type { DeletedReason, Expense } from './expense.repository.ts';

/**
 * How a record relates to its Excel row:
 *   synced          the Excel row is identical to the record, sync is done
 *   pending-add     the record is not in Excel yet, it waits in the add queue
 *   pending-update  the record was edited, the Excel row is the old one: waits for an update
 *   pending-remove  the record was deleted but its row is still in Excel: waits for removal
 *   removed         the record was deleted in the app, the row was removed from Excel
 *   missing         the record was deleted because its row was removed in Excel itself
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

/** Record state relative to Excel; derived from the record itself and the row snapshot. */
export function describeExcelState(row: ExcelStateInput): ExcelState {
  if (row.deletedAt !== null) {
    if (row.excelSnapshot !== null) return 'pending-remove';
    return row.deletedReason === 'excel' ? 'missing' : 'removed';
  }
  if (row.excelSnapshot === null) return 'pending-add';
  return sameValues(row, row.excelSnapshot) ? 'synced' : 'pending-update';
}

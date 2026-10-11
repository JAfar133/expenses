import type { Expense, StoredExpense } from '../../storage/expense.repository.ts';

export interface ReconcilePlan {
  /** Excel rows that are not in the DB: they need to be added to the DB */
  toImport: Expense[];
  /** "writing" records that turned out to be in Excel: the write happened, mark as synced */
  promoteToSynced: string[];
  /** "writing" records that are not in Excel: the write did not happen, return to the queue */
  revertToPending: string[];
  /** DB records no longer in Excel (the row was deleted or changed): mark as deleted */
  toDelete: string[];
  /** Previously deleted records whose rows reappeared in Excel (undo, rollback from a copy) */
  toRestore: string[];
  /** Records deleted in the app whose Excel row is already gone: nothing to remove from Excel */
  toClearSnapshot: string[];
}

const keyOf = (e: Expense) => JSON.stringify([e.date, e.card, e.category, e.name, e.amount]);

/**
 * How a record looks in Excel. If a record was edited in the app but Excel is not updated yet,
 * Excel holds the old values (the snapshot), not the current ones: matching must use them.
 */
const excelKeyOf = (row: StoredExpense) => keyOf(row.excelSnapshot ?? row);

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const list = groups.get(key(item)) ?? [];
    list.push(item);
    groups.set(key(item), list);
  }
  return groups;
}

/**
 * Reconciles Excel with the DB. Excel has no row identifiers, so identical operations
 * are matched **by count**: two identical expenses are two expenses, not a duplicate.
 *
 * For each operation we count how many times it is in Excel (E) and how many active DB records
 * already marked as being in Excel (S):
 *   - E > S: extra Excel rows — first these are our "writing" records (the write went through but we
 *     did not get to record it), then previously deleted records (the row was put back in Excel), and
 *     only the rest are new rows added to Excel manually;
 *   - E < S: a row was deleted or changed in Excel — the extra DB records are marked deleted.
 *     A changed row is an "old deleted" plus a "new" one, so an edit is reflected too.
 *
 * Records deleted in the app whose rows are still in Excel count as present: these rows
 * are not imported as new, and if the row disappears on its own, the snapshot is simply cleared.
 *
 * "pending" records do not take part in reconciliation: they are not in Excel yet. Which exactly of the identical records
 * to delete or restore does not matter: they are interchangeable.
 */
export function reconcile(excelRows: Expense[], dbRows: StoredExpense[]): ReconcilePlan {
  const plan: ReconcilePlan = {
    toImport: [],
    promoteToSynced: [],
    revertToPending: [],
    toDelete: [],
    toRestore: [],
    toClearSnapshot: [],
  };

  const inExcel = groupBy(excelRows, keyOf);
  const active = groupBy(
    dbRows.filter((row) => row.excelStatus === 'synced' && row.deletedAt === null),
    excelKeyOf,
  );
  const writing = groupBy(
    dbRows.filter((row) => row.excelStatus === 'writing' && row.deletedAt === null),
    keyOf,
  );
  // Deleted in the app, the row is still in Excel (snapshot is set)
  const removing = groupBy(
    dbRows.filter((row) => row.deletedAt !== null && row.excelSnapshot !== null),
    excelKeyOf,
  );
  // Only records deleted because their row vanished in Excel can come back together with the row; records deleted in the app do not come back
  const deleted = groupBy(
    dbRows.filter(
      (row) => row.deletedAt !== null && row.excelSnapshot === null && row.deletedReason !== 'app',
    ),
    keyOf,
  );

  for (const key of new Set([
    ...inExcel.keys(),
    ...active.keys(),
    ...writing.keys(),
    ...removing.keys(),
    ...deleted.keys(),
  ])) {
    const excelItems = inExcel.get(key) ?? [];
    const activeItems = active.get(key) ?? [];
    const writingItems = writing.get(key) ?? [];
    const removingItems = removing.get(key) ?? [];
    const deletedItems = deleted.get(key) ?? [];
    const excess = excelItems.length - activeItems.length - removingItems.length;

    if (excess < 0) {
      // First treat as missing the rows we were going to remove anyway, then the active records.
      // We delete the newest of the identical records: the DB order is the insertion order
      const missing = -excess;
      const fromRemoving = Math.min(missing, removingItems.length);
      plan.toClearSnapshot.push(...removingItems.slice(0, fromRemoving).map((row) => row.id));
      const fromActive = missing - fromRemoving;
      if (fromActive > 0)
        plan.toDelete.push(...activeItems.slice(-fromActive).map((row) => row.id));
    }

    const promoted = writingItems.slice(0, Math.max(excess, 0));
    plan.promoteToSynced.push(...promoted.map((row) => row.id));
    plan.revertToPending.push(...writingItems.slice(promoted.length).map((row) => row.id));

    const unmatched = Math.max(excess - promoted.length, 0);

    // First restore the recently deleted ones, so that a rollback in Excel does not create duplicates
    const restored = [...deletedItems]
      .sort((a, b) => (b.deletedAt ?? '').localeCompare(a.deletedAt ?? ''))
      .slice(0, unmatched);
    plan.toRestore.push(...restored.map((row) => row.id));

    plan.toImport.push(...excelItems.slice(0, unmatched - restored.length));
  }

  return plan;
}

/** Protection against mass loss: replacing Excel with an empty or old file must not "delete" the database. */
export interface DeletionGuardInput {
  toDelete: number;
  /** Active DB records considered to be in Excel */
  activeSynced: number;
  excelRows: number;
  /** Maximum share of records (in percent) that may be deleted in one cycle */
  maxPercent: number;
}

/** Fewer records than this are deleted without the share check: this way we do not interfere with normal work. */
const MIN_GUARDED_DELETIONS = 5;

export function isMassDeletion({
  toDelete,
  activeSynced,
  excelRows,
  maxPercent,
}: DeletionGuardInput): boolean {
  if (toDelete === 0) return false;
  // Excel has no rows at all while the database has some: most likely the file is empty or corrupted
  if (excelRows === 0 && activeSynced > 0) return true;
  if (toDelete < MIN_GUARDED_DELETIONS) return false;
  return (toDelete * 100) / activeSynced > maxPercent;
}

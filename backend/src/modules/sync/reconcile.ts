import type { Expense, StoredExpense } from '../../storage/expense.repository.ts';

export interface ReconcilePlan {
  /** Строки Excel, которых нет в БД: их нужно добавить в БД */
  toImport: Expense[];
  /** Записи «writing», которые оказались в Excel: запись состоялась, помечаем synced */
  promoteToSynced: string[];
  /** Записи «writing», которых в Excel нет: запись не состоялась, возвращаем в очередь */
  revertToPending: string[];
  /** Сколько синхронизированных записей БД отсутствуют в Excel (удалены или изменены там) */
  diverged: number;
}

const keyOf = (e: Expense) => JSON.stringify([e.date, e.card, e.category, e.name, e.amount]);

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
 * Сверяет Excel с БД. В Excel нет идентификаторов строк, поэтому одинаковые операции
 * сопоставляются по количеству: два одинаковых расхода — это два расхода, а не дубликат.
 *
 * Для каждой операции считаем, сколько раз она есть в Excel (E) и сколько записей БД
 * уже помечены как находящиеся в Excel (S):
 *   - E > S: лишние строки Excel — сначала это наши «writing» записи (запись дошла, но мы не
 *     успели это зафиксировать), остальное — новые строки, добавленные в Excel вручную;
 *   - E < S: в Excel строку удалили или изменили, считаем расхождением и ничего не удаляем.
 *
 * Записи «pending» в сверке не участвуют: их в Excel ещё нет.
 */
export function reconcile(excelRows: Expense[], dbRows: StoredExpense[]): ReconcilePlan {
  const plan: ReconcilePlan = {
    toImport: [],
    promoteToSynced: [],
    revertToPending: [],
    diverged: 0,
  };

  const inExcel = groupBy(excelRows, keyOf);
  const synced = groupBy(
    dbRows.filter((row) => row.excelStatus === 'synced'),
    keyOf,
  );
  const writing = groupBy(
    dbRows.filter((row) => row.excelStatus === 'writing'),
    keyOf,
  );

  for (const key of new Set([...inExcel.keys(), ...synced.keys(), ...writing.keys()])) {
    const excelItems = inExcel.get(key) ?? [];
    const syncedCount = synced.get(key)?.length ?? 0;
    const writingItems = writing.get(key) ?? [];
    const excess = excelItems.length - syncedCount;

    if (excess < 0) {
      plan.diverged += -excess;
    }

    const promoted = writingItems.slice(0, Math.max(excess, 0));
    plan.promoteToSynced.push(...promoted.map((row) => row.id));
    plan.revertToPending.push(...writingItems.slice(promoted.length).map((row) => row.id));

    const newRows = Math.max(excess - promoted.length, 0);
    plan.toImport.push(...excelItems.slice(0, newRows));
  }

  return plan;
}

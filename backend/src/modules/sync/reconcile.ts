import type { Expense, StoredExpense } from '../../storage/expense.repository.ts';

export interface ReconcilePlan {
  /** Строки Excel, которых нет в БД: их нужно добавить в БД */
  toImport: Expense[];
  /** Записи «writing», которые оказались в Excel: запись состоялась, помечаем synced */
  promoteToSynced: string[];
  /** Записи «writing», которых в Excel нет: запись не состоялась, возвращаем в очередь */
  revertToPending: string[];
  /** Записи БД, которых больше нет в Excel (строку удалили или изменили): помечаем удалёнными */
  toDelete: string[];
  /** Ранее удалённые записи, строки которых снова появились в Excel (отмена, откат из копии) */
  toRestore: string[];
  /** Удалённые в приложении записи, чьей строки в Excel уже нет: убирать из Excel нечего */
  toClearSnapshot: string[];
}

const keyOf = (e: Expense) => JSON.stringify([e.date, e.card, e.category, e.name, e.amount]);

/**
 * Как запись выглядит в Excel. Если запись правили в приложении, но Excel ещё не обновлён,
 * в Excel лежат прежние значения (снимок), а не текущие: сопоставлять нужно по ним.
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
 * Сверяет Excel с БД. В Excel нет идентификаторов строк, поэтому одинаковые операции
 * сопоставляются **по количеству**: два одинаковых расхода — это два расхода, а не дубликат.
 *
 * Для каждой операции считаем, сколько раз она есть в Excel (E) и сколько активных записей БД
 * уже помечены как находящиеся в Excel (S):
 *   - E > S: лишние строки Excel — сначала это наши «writing» записи (запись дошла, но мы не
 *     успели это зафиксировать), затем ранее удалённые записи (строку вернули в Excel), и
 *     только остальное — новые строки, добавленные в Excel вручную;
 *   - E < S: строку в Excel удалили или изменили — лишние записи БД помечаются удалёнными.
 *     Изменённая строка — это «удалённая старая» плюс «новая», поэтому правка тоже отражается.
 *
 * Записи, удалённые в приложении, чьи строки ещё лежат в Excel, считаются присутствующими: эти строки
 * не импортируются как новые, а если строка пропала сама, снимок просто сбрасывается.
 *
 * Записи «pending» в сверке не участвуют: их в Excel ещё нет. Какие именно из одинаковых записей
 * удалить или восстановить, не важно: они взаимозаменяемы.
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
  // Удалены в приложении, строка ещё в Excel (снимок задан)
  const removing = groupBy(
    dbRows.filter((row) => row.deletedAt !== null && row.excelSnapshot !== null),
    excelKeyOf,
  );
  // Только удалённые из-за пропажи строки в Excel могут вернуться вместе со строкой; удалённые в приложении не возвращаются
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
      // Сначала пропавшими считаем строки, которые мы и так собирались убрать, потом уже активные записи.
      // Удаляем самые новые из одинаковых записей: порядок в БД — порядок добавления
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

    // Сначала возвращаем недавно удалённые, чтобы откат в Excel не создавал дубликаты
    const restored = [...deletedItems]
      .sort((a, b) => (b.deletedAt ?? '').localeCompare(a.deletedAt ?? ''))
      .slice(0, unmatched);
    plan.toRestore.push(...restored.map((row) => row.id));

    plan.toImport.push(...excelItems.slice(0, unmatched - restored.length));
  }

  return plan;
}

/** Защита от массовой потери: подмена Excel пустым или старым файлом не должна «удалить» базу. */
export interface DeletionGuardInput {
  toDelete: number;
  /** Активные записи БД, которые считаются находящимися в Excel */
  activeSynced: number;
  excelRows: number;
  /** Максимальная доля записей (в процентах), которую можно удалить за один цикл */
  maxPercent: number;
}

/** Меньше этого числа записей удаляем без проверки доли: так не мешаем обычной работе. */
const MIN_GUARDED_DELETIONS = 5;

export function isMassDeletion({
  toDelete,
  activeSynced,
  excelRows,
  maxPercent,
}: DeletionGuardInput): boolean {
  if (toDelete === 0) return false;
  // В Excel нет ни одной строки, а в базе есть: скорее всего, файл пуст или повреждён
  if (excelRows === 0 && activeSynced > 0) return true;
  if (toDelete < MIN_GUARDED_DELETIONS) return false;
  return (toDelete * 100) / activeSynced > maxPercent;
}

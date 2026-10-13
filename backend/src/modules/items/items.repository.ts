import type { SqlExecutor } from '../../infrastructure/database/database.ts';
import type { ExpenseItem, ItemSource, NewItem } from './items.types.ts';

interface ItemRow {
  id: string;
  position: number;
  name: string;
  price: string;
  quantity: string;
  source: ItemSource;
}

const toItem = (row: ItemRow): ExpenseItem => ({
  id: row.id,
  position: row.position,
  name: row.name,
  price: Number(row.price),
  quantity: Number(row.quantity),
  source: row.source,
});

/** Positions of expenses. A list is always replaced as a whole; the change log keeps what it was before. */
export class ItemsRepository {
  list(db: SqlExecutor, expenseId: string): Promise<ExpenseItem[]> {
    return db
      .query<ItemRow>(
        `SELECT id, position, name, price::text, quantity::text, source
           FROM expense_items WHERE expense_id = $1 ORDER BY position`,
        [expenseId],
      )
      .then((rows) => rows.map(toItem));
  }

  async replace(
    db: SqlExecutor,
    expense: { id: string; groupId: string },
    items: NewItem[],
  ): Promise<ExpenseItem[]> {
    await db.query('DELETE FROM expense_items WHERE expense_id = $1', [expense.id]);
    for (const [position, item] of items.entries()) {
      await db.query(
        `INSERT INTO expense_items (expense_id, group_id, position, name, price, quantity, source)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [expense.id, expense.groupId, position, item.name, item.price, item.quantity, item.source],
      );
    }
    return this.list(db, expense.id);
  }

  /** How many items each of the expenses has (expenses without items are absent). */
  async counts(db: SqlExecutor, expenseIds: string[]): Promise<Map<string, number>> {
    if (expenseIds.length === 0) return new Map();
    const rows = await db.query<{ expense_id: string; count: number }>(
      `SELECT expense_id, count(*)::int AS count FROM expense_items
        WHERE expense_id = ANY($1::uuid[]) GROUP BY expense_id`,
      [expenseIds],
    );
    return new Map(rows.map((row) => [row.expense_id, row.count]));
  }
}

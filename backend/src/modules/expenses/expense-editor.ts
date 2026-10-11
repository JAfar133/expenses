import { AppError, notFoundError, validationError } from '../../errors/app-error.ts';
import type { Database } from '../../infrastructure/database/database.ts';
import type {
  Expense,
  ExpenseRepository,
  StoredExpense,
} from '../../storage/expense.repository.ts';

/** Which record fields can be edited. The rest (author, source, original currency) stay as they were. */
export type ExpensePatch = Partial<Expense>;

export interface EditResult {
  record: StoredExpense;
  /** false: the record was already in the desired state, nothing changed */
  changed: boolean;
}

export interface ExpenseEditorOptions {
  database: Database;
  repository: ExpenseRepository;
  /** Allowed cards */
  cards: string[];
}

const busyError = () =>
  new AppError(
    409,
    'EXPENSE_BUSY',
    'Запись сейчас записывается в Excel. Повторите через несколько секунд',
  );

const valuesOf = ({ date, card, category, name, amount }: Expense): Expense => ({
  date,
  card,
  category,
  name,
  amount,
});

/**
 * Editing, deleting and restoring records. Changes only the database: sync brings the Excel rows in line
 * (it sees the difference between the record and the row snapshot). Every change is written to the log.
 * Deletion is soft: the record stays in the database and can be restored.
 */
export class ExpenseEditor {
  constructor(private readonly options: ExpenseEditorOptions) {}

  update(id: string, patch: ExpensePatch, by: string): Promise<EditResult> {
    return this.edit(id, async (tx, record) => {
      if (record.deletedAt !== null) {
        throw new AppError(409, 'EXPENSE_DELETED', 'Запись удалена: сначала верните её');
      }
      const before = valuesOf(record);
      const after: Expense = { ...before, ...patch };

      if (patch.card !== undefined && !this.options.cards.includes(after.card)) {
        throw validationError('INVALID_CARD', 'Выберите карту из списка');
      }
      if (JSON.stringify(before) === JSON.stringify(after)) return false;

      // The original currency amount no longer matches the drams if the amount was changed
      const clearOriginal = record.original !== null && after.amount !== before.amount;
      const { repository } = this.options;
      await repository.updateValues(tx, id, after, by, clearOriginal);
      await repository.recordChange(tx, {
        expenseId: id,
        by,
        action: 'update',
        before: { ...before, original: record.original },
        after: { ...after, original: clearOriginal ? null : record.original },
      });
      return true;
    });
  }

  remove(id: string, by: string): Promise<EditResult> {
    return this.edit(id, async (tx, record) => {
      if (record.deletedAt !== null) return false;
      const { repository } = this.options;
      await repository.markDeletedByApp(tx, id, by);
      await repository.recordChange(tx, {
        expenseId: id,
        by,
        action: 'delete',
        before: valuesOf(record),
        after: null,
      });
      return true;
    });
  }

  restore(id: string, by: string): Promise<EditResult> {
    return this.edit(id, async (tx, record) => {
      if (record.deletedAt === null) return false;
      const { repository } = this.options;
      await repository.restoreByApp(tx, id, by);
      await repository.recordChange(tx, {
        expenseId: id,
        by,
        action: 'restore',
        before: null,
        after: valuesOf(record),
      });
      return true;
    });
  }

  /** Common wrapper: transaction, record lock, a ban on changing a record that is being written to Excel right now. */
  private async edit(
    id: string,
    work: (
      tx: Parameters<ExpenseRepository['findForUpdate']>[0],
      record: StoredExpense,
    ) => Promise<boolean>,
  ): Promise<EditResult> {
    const { database, repository } = this.options;

    return database.transaction(async (tx) => {
      const record = await repository.findForUpdate(tx, id);
      if (!record) throw notFoundError();
      if (record.excelStatus === 'writing') throw busyError();

      const changed = await work(tx, record);
      return { record: (await repository.findForUpdate(tx, id))!, changed };
    });
  }
}

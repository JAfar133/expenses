import { AppError, notFoundError, validationError } from '../../errors/app-error.ts';
import type { Database, SqlExecutor } from '../../infrastructure/database/database.ts';
import { decimalsOf } from './expense-amount.ts';
import type { GroupsRepository } from '../groups/groups.repository.ts';
import type {
  Expense,
  ExpenseMoney,
  ExpenseRepository,
  StoredExpense,
} from '../../storage/expense.repository.ts';

const MAX_DRAMS = 2_147_483_647;

const roundTo = (value: number, decimals: number) =>
  Math.round(value * 10 ** decimals) / 10 ** decimals;

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
  /** Cards of the group: a record may be moved to any of them */
  groups: Pick<GroupsRepository, 'cardNames' | 'categoryNames' | 'moneyContext'>;
  /** Base currency of the drams amounts (Excel): AMD by default */
  base?: string;
}

/** Who edits: the login goes to the log, the group limits which records can be touched. */
export interface EditActor {
  username: string;
  groupId: string | null;
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

  update(id: string, patch: ExpensePatch, actor: EditActor): Promise<EditResult> {
    const by = actor.username;
    return this.edit(id, actor, async (tx, record) => {
      if (record.deletedAt !== null) {
        throw new AppError(409, 'EXPENSE_DELETED', 'Запись удалена: сначала верните её');
      }
      // The amount in a patch is in the currency of the card; the drams amount (Excel) follows from it
      const { amount: newCardAmount, ...rest } = patch;
      const before = valuesOf(record);
      const after: Expense = { ...before, ...rest };

      if (patch.card !== undefined && !(await this.groupCards(actor, tx)).includes(after.card)) {
        throw validationError('INVALID_CARD', 'Выберите карту из списка');
      }
      if (patch.card !== undefined && patch.card !== record.card) {
        await this.requireSameCurrency(actor, tx, record, after.card);
      }
      if (
        patch.category !== undefined &&
        !(await this.options.groups.categoryNames(actor.groupId, tx)).includes(after.category)
      ) {
        throw validationError('INVALID_CATEGORY', 'Выберите категорию из списка');
      }

      const repriced =
        newCardAmount !== undefined ? this.reprice(record, newCardAmount) : undefined;
      if (repriced) after.amount = repriced.amount;
      const moneyChanged =
        repriced !== undefined &&
        repriced.money.cardAmount !== (record.money?.cardAmount ?? record.amount);
      if (JSON.stringify(before) === JSON.stringify(after) && !moneyChanged) return false;

      // The original currency amount no longer matches the new amount
      const clearOriginal =
        record.original !== null && (moneyChanged || after.amount !== before.amount);
      const { repository } = this.options;
      await repository.updateValues(tx, id, after, by, clearOriginal, repriced?.money);
      await repository.recordChange(tx, {
        expenseId: id,
        by,
        action: 'update',
        before: { ...before, original: record.original, money: record.money },
        after: {
          ...after,
          original: clearOriginal ? null : record.original,
          money: repriced?.money ?? record.money,
        },
      });
      return true;
    });
  }

  /**
   * A new amount in the card's currency: the other amounts of the record follow in the same proportion
   * as when it was entered (so the rates of that day stay).
   */
  private reprice(
    record: StoredExpense,
    cardAmount: number,
  ): { amount: number; money: ExpenseMoney } {
    const base = this.options.base ?? 'AMD';
    const money = record.money ?? {
      cardCurrency: base,
      cardAmount: record.amount,
      reportingCurrency: base,
      reportingAmount: record.amount,
    };
    const decimals = decimalsOf(money.cardCurrency, base);
    if (
      !(cardAmount > 0) ||
      Math.abs(cardAmount * 10 ** decimals - Math.round(cardAmount * 10 ** decimals)) > 1e-6
    ) {
      throw validationError(
        'INVALID_AMOUNT',
        decimals === 0
          ? 'Стоимость должна быть целым числом'
          : 'Не более двух знаков после запятой',
      );
    }
    const factor = cardAmount / money.cardAmount;
    const reporting =
      money.reportingCurrency === money.cardCurrency
        ? cardAmount
        : roundTo(money.reportingAmount * factor, decimalsOf(money.reportingCurrency, base));
    const amount = Math.round(record.amount * factor);
    if (amount < 1 || amount > MAX_DRAMS || !(reporting > 0)) {
      throw validationError(
        'INVALID_AMOUNT',
        amount < 1 ? 'Сумма слишком мала' : 'Слишком большая сумма',
      );
    }
    return { amount, money: { ...money, cardAmount, reportingAmount: reporting } };
  }

  /** A record may only move to a card in the same currency: its amounts would not match otherwise. */
  private async requireSameCurrency(
    actor: EditActor,
    tx: SqlExecutor,
    record: StoredExpense,
    cardName: string,
  ): Promise<void> {
    const target = await this.options.groups.moneyContext(actor.groupId, cardName, tx);
    const current = record.money?.cardCurrency ?? this.options.base ?? 'AMD';
    if (target && target.cardCurrency !== current) {
      throw validationError(
        'CARD_CURRENCY_MISMATCH',
        'Нельзя перенести трату на карту в другой валюте',
      );
    }
  }

  remove(id: string, actor: EditActor): Promise<EditResult> {
    const by = actor.username;
    return this.edit(id, actor, async (tx, record) => {
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

  restore(id: string, actor: EditActor): Promise<EditResult> {
    const by = actor.username;
    return this.edit(id, actor, async (tx, record) => {
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
  private groupCards(actor: EditActor, db: SqlExecutor): Promise<string[]> {
    return actor.groupId ? this.options.groups.cardNames(actor.groupId, db) : Promise.resolve([]);
  }

  private async edit(
    id: string,
    actor: EditActor,
    work: (
      tx: Parameters<ExpenseRepository['findForUpdate']>[0],
      record: StoredExpense,
    ) => Promise<boolean>,
  ): Promise<EditResult> {
    const { database, repository } = this.options;

    return database.transaction(async (tx) => {
      const record = await repository.findForUpdate(tx, id);
      // A record of another group looks the same as a missing one
      if (!record || !actor.groupId || record.groupId !== actor.groupId) throw notFoundError();
      if (record.excelStatus === 'writing') throw busyError();

      const changed = await work(tx, record);
      return { record: (await repository.findForUpdate(tx, id))!, changed };
    });
  }
}

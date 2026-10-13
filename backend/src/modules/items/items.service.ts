import { notFoundError } from '../../errors/app-error.ts';
import type { Database } from '../../infrastructure/database/database.ts';
import type { AuthUser } from '../auth/auth.types.ts';
import type { ExpenseEditor } from '../expenses/expense-editor.ts';
import type { ExpenseRepository } from '../../storage/expense.repository.ts';
import type { ReceiptsRepository } from '../receipts/receipts.repository.ts';
import { parseItemsBody } from './items.schema.ts';
import type { ItemsRepository } from './items.repository.ts';
import type { ExpenseItem } from './items.types.ts';
import { withSources } from './keep-source.ts';

export interface ItemsServiceOptions {
  database: Database;
  repository: ItemsRepository;
  editor: ExpenseEditor;
  expenses: Pick<ExpenseRepository, 'recordChange'>;
  /** Who sees an expense: the same rule as for receipt photos */
  access: Pick<ReceiptsRepository, 'findExpense' | 'memberSees'>;
}

/** Items of an expense: seen by whoever sees the expense, changed by whoever may edit it. */
export class ItemsService {
  constructor(private readonly options: ItemsServiceOptions) {}

  async list(user: AuthUser, expenseId: string): Promise<ExpenseItem[]> {
    const { access, database, repository } = this.options;
    const expense = await access.findExpense(expenseId);
    if (!expense || !user.groupId || expense.groupId !== user.groupId) throw notFoundError();
    if (user.role !== 'owner' && !(await access.memberSees(user.id, expense.id))) {
      throw notFoundError();
    }
    return repository.list(database, expense.id);
  }

  /** Replaces the list (an empty list removes all items). */
  async replace(user: AuthUser, expenseId: string, body: unknown): Promise<ExpenseItem[]> {
    const input = parseItemsBody(body);
    const { editor, repository, expenses } = this.options;
    const actor = {
      userId: user.id,
      username: user.username,
      groupId: user.groupId,
      role: user.role,
    };

    return editor.withEditAccess(expenseId, actor, async (tx, record) => {
      const before = await repository.list(tx, record.id);
      const saved = await repository.replace(
        tx,
        { id: record.id, groupId: record.groupId! },
        withSources(input, before),
      );
      await expenses.recordChange(tx, {
        expenseId: record.id,
        by: user.username,
        action: 'update',
        before: { items: before },
        after: { items: saved },
      });
      return saved;
    });
  }
}

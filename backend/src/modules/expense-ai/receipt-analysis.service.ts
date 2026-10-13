import { AppError } from '../../errors/app-error.ts';
import type { ExpenseRepository } from '../../storage/expense.repository.ts';
import { todayIn } from '../analytics/date-math.ts';
import type { AuthUser } from '../auth/auth.types.ts';
import type { ExpenseEditor } from '../expenses/expense-editor.ts';
import type { ItemsRepository } from '../items/items.repository.ts';
import type { LlmService } from '../llm/llm.service.ts';
import { aiCategoryOff } from '../llm/llm.types.ts';
import type { ReceiptsRepository } from '../receipts/receipts.repository.ts';
import type { ReceiptsService } from '../receipts/receipts.service.ts';
import type { ExpenseAiRepository } from './expense-ai.repository.ts';
import { planReceipt } from './plan-receipt.ts';

export interface ReceiptAnalysisOptions {
  llm: Pick<LlmService, 'parseReceipt'>;
  receipts: Pick<ReceiptsService, 'readForChange'>;
  /** Which categories the owner allowed the AI for */
  categories: Pick<ReceiptsRepository, 'aiAllowed'>;
  expenses: Pick<ExpenseRepository, 'recordChange'>;
  items: ItemsRepository;
  repository: ExpenseAiRepository;
  editor: Pick<ExpenseEditor, 'withEditAccess'>;
  now?: () => Date;
}

/** What parsing did: shown to the person after the receipt is processed. */
export interface AnalysisResult {
  nameFilled: boolean;
  dateFilled: boolean;
  itemsFilled: number;
  /** The receipt has items, but the person's own items were kept: they can ask to replace them */
  itemsOffered: boolean;
  /** Lines of the receipt the checks dropped */
  dropped: number;
  /** The total and the currency printed on the receipt (only for comparison with the amount) */
  total: number | null;
  currency: string | null;
}

/** Parses the receipt photo of an expense and writes what a person has not entered themselves. */
export class ReceiptAnalysisService {
  constructor(private readonly options: ReceiptAnalysisOptions) {}

  async analyze(
    user: AuthUser,
    expenseId: string,
    { replaceItems = false }: { replaceItems?: boolean } = {},
  ): Promise<AnalysisResult> {
    const { llm, receipts, items, repository, expenses, editor } = this.options;
    const { expense, image } = await receipts.readForChange(user, expenseId);
    if (!(await this.options.categories.aiAllowed(expense.groupId, expense.category))) {
      throw aiCategoryOff();
    }
    const today = todayIn(user.timezone, this.options.now?.());

    // The slow call to the model happens outside of any transaction
    const { receipt, model } = await llm.parseReceipt({
      groupId: expense.groupId,
      username: user.username,
      expenseId: expense.id,
      image,
      today,
    });

    const actor = {
      userId: user.id,
      username: user.username,
      groupId: user.groupId,
      role: user.role,
    };
    return editor.withEditAccess(expense.id, actor, async (tx, record) => {
      if (record.deletedAt !== null) {
        throw new AppError(409, 'EXPENSE_DELETED', 'Запись удалена: сначала верните её');
      }
      const state = (await repository.lock(tx, record.id))!;
      const before = await items.list(tx, record.id);
      const plan = planReceipt({ ...state, items: before }, receipt, { today, replaceItems });

      await repository.applyReceipt(tx, record.id, { name: plan.name, date: plan.date, model });
      const after = plan.items
        ? await items.replace(
            tx,
            { id: record.id, groupId: expense.groupId },
            plan.items.map((item) => ({ ...item, source: 'ai' as const })),
          )
        : before;
      await expenses.recordChange(tx, {
        expenseId: record.id,
        by: 'ai',
        action: 'update',
        before: { name: state.name, date: state.date, items: before },
        after: { name: plan.name ?? state.name, date: plan.date ?? state.date, items: after },
      });

      return {
        nameFilled: plan.name !== undefined,
        dateFilled: plan.date !== undefined,
        itemsFilled: plan.items?.length ?? 0,
        itemsOffered: plan.itemsKept,
        dropped: receipt.dropped,
        total: receipt.total ?? null,
        currency: receipt.currency ?? null,
      };
    });
  }

  /** The person accepts what the AI generated: the marks go away, the values stay. */
  async removeMarks(user: AuthUser, expenseId: string): Promise<void> {
    const { items, repository, editor } = this.options;
    const actor = {
      userId: user.id,
      username: user.username,
      groupId: user.groupId,
      role: user.role,
    };
    await editor.withEditAccess(expenseId, actor, async (tx, record) => {
      await repository.adoptGenerated(tx, record.id);
      const current = await items.list(tx, record.id);
      await items.replace(
        tx,
        { id: record.id, groupId: record.groupId! },
        current.map(({ name, price, quantity }) => ({
          name,
          price,
          quantity,
          source: 'manual' as const,
        })),
      );
    });
  }
}

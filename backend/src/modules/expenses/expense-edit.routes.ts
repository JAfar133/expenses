import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { forbiddenError, validationError } from '../../errors/app-error.ts';
import type { AuthUser } from '../auth/auth.types.ts';
import type { ExpenseRepository } from '../../storage/expense.repository.ts';
import { describeExcelState } from '../../storage/excel-state.ts';
import { waitForExcelWrite } from '../sync/inline-wait.ts';
import type { SyncService } from '../sync/sync.service.ts';
import type { ExpenseEditor } from './expense-editor.ts';
import { createExpenseSchema, FIELD_ERROR_CODES } from './expenses.schema.ts';

const patchSchema = z
  .object({
    date: createExpenseSchema.shape.date,
    card: createExpenseSchema.shape.card,
    category: createExpenseSchema.shape.category,
    name: createExpenseSchema.shape.name,
    // In the currency of the card; the service checks whole drams / two decimals
    amount: createExpenseSchema.shape.amount,
  })
  .partial()
  .strict();

const idSchema = z.uuid();

const actorOf = ({ username, groupId }: AuthUser) => ({ username, groupId });

export interface ExpenseEditRoutesDeps {
  editor: ExpenseEditor;
  repository: Pick<ExpenseRepository, 'findById'>;
  sync: Pick<SyncService, 'requestCycle' | 'enabled'>;
  inlineExcelWaitMs: number;
}

export const expenseEditRoutes =
  ({ editor, repository, sync, inlineExcelWaitMs }: ExpenseEditRoutesDeps): FastifyPluginAsync =>
  async (app) => {
    /** Editing and deleting are available to the group owner only; members can add records and view. */
    const requireEditor = (request: { user?: { canEdit: boolean } }) => {
      if (!request.user?.canEdit) throw forbiddenError();
    };

    const parseId = (params: unknown) => {
      const parsed = idSchema.safeParse((params as { id?: string }).id);
      if (!parsed.success) throw validationError('INVALID_ID', 'Некорректный идентификатор записи');
      return parsed.data;
    };

    /** Response: the record and its state relative to Excel. If Excel responds quickly, the change is already in it. */
    const respond = async (id: string, changed: boolean, message: string) => {
      if (changed && sync.enabled) await waitForExcelWrite(sync, inlineExcelWaitMs);
      const record = (await repository.findById(id))!;
      return {
        success: true,
        data: {
          id: record.id,
          date: record.date,
          card: record.card,
          category: record.category,
          name: record.name,
          amount: record.amount,
          deletedAt: record.deletedAt,
          excelState: describeExcelState(record),
        },
        message,
      };
    };

    app.patch('/expenses/:id', async (request) => {
      requireEditor(request);
      const id = parseId(request.params);

      const parsed = patchSchema.safeParse(request.body);
      if (!parsed.success) {
        const issue = parsed.error.issues[0]!;
        const field = String(issue.path[0] ?? '');
        throw validationError(FIELD_ERROR_CODES[field] ?? 'VALIDATION_ERROR', issue.message);
      }
      if (Object.keys(parsed.data).length === 0) {
        throw validationError('NOTHING_TO_UPDATE', 'Не указано, что изменить');
      }

      const { changed } = await editor.update(id, parsed.data, actorOf(request.user!));
      request.log.info(
        { operation: 'expense.update', expenseId: id, userId: request.user!.username, changed },
        'Operation completed',
      );
      return respond(id, changed, changed ? 'Запись изменена' : 'Изменений нет');
    });

    app.delete('/expenses/:id', async (request) => {
      requireEditor(request);
      const id = parseId(request.params);

      const { changed } = await editor.remove(id, actorOf(request.user!));
      request.log.info(
        { operation: 'expense.delete', expenseId: id, userId: request.user!.username, changed },
        'Operation completed',
      );
      return respond(id, changed, 'Запись удалена. Её можно вернуть');
    });

    app.post('/expenses/:id/restore', async (request) => {
      requireEditor(request);
      const id = parseId(request.params);

      const { changed } = await editor.restore(id, actorOf(request.user!));
      request.log.info(
        { operation: 'expense.restore', expenseId: id, userId: request.user!.username, changed },
        'Operation completed',
      );
      return respond(id, changed, 'Запись возвращена');
    });
  };

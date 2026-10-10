import type { FastifyPluginAsync } from 'fastify';
import { validationError } from '../../errors/app-error.ts';
import { createExpenseSchema, FIELD_ERROR_CODES } from './expenses.schema.ts';
import type { ExpenseService } from './expenses.service.ts';

export const expensesRoutes =
  (service: ExpenseService): FastifyPluginAsync =>
  async (app) => {
    app.post('/expenses', async (request, reply) => {
      const parsed = createExpenseSchema.safeParse(request.body);
      if (!parsed.success) {
        const issue = parsed.error.issues[0]!;
        const code = FIELD_ERROR_CODES[String(issue.path[0])] ?? 'VALIDATION_ERROR';
        throw validationError(code, issue.message);
      }

      const expense = await service.create(parsed.data);
      return reply
        .code(201)
        .send({ success: true, data: expense, message: 'Расход успешно добавлен' });
    });

    app.get('/cards', async () => ({ success: true, data: service.getCards() }));

    app.get('/categories', async () => ({ success: true, data: await service.getCategories() }));
  };

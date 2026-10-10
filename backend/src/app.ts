import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import { AppError } from './errors/app-error.ts';
import { expensesRoutes } from './modules/expenses/expenses.routes.ts';
import type { ExpenseService } from './modules/expenses/expenses.service.ts';

export interface AppDependencies {
  expenseService: ExpenseService;
  logger?: FastifyServerOptions['logger'];
}

export function buildApp({ expenseService, logger = false }: AppDependencies): FastifyInstance {
  const app = Fastify({ logger });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      request.log.warn({ err: error, code: error.code }, 'Request failed');
      return reply.code(error.statusCode).send(errorBody(error.code, error.message));
    }

    // Ошибки Fastify до наших обработчиков: битый JSON, неверный Content-Type и т.п.
    const status = (error as { statusCode?: number }).statusCode;
    if (status && status >= 400 && status < 500) {
      return reply.code(status).send(errorBody('BAD_REQUEST', 'Некорректный запрос'));
    }

    request.log.error({ err: error }, 'Unhandled error');
    return reply
      .code(500)
      .send(errorBody('INTERNAL_ERROR', 'Не удалось сохранить расход. Попробуйте позже'));
  });

  app.get('/api/health', async () => ({ status: 'ok' }));
  app.register(expensesRoutes(expenseService), { prefix: '/api' });

  return app;
}

const errorBody = (code: string, message: string) => ({
  success: false,
  error: { code, message },
});

import { randomUUID } from 'node:crypto';
import Fastify, { LogController, type FastifyInstance, type FastifyServerOptions } from 'fastify';
import { AppError, databaseUnavailableError } from './errors/app-error.ts';
import type { IdempotencyService } from './infrastructure/idempotency/idempotency.service.ts';
import { authPlugin } from './modules/auth/auth.plugin.ts';
import { authRoutes } from './modules/auth/auth.routes.ts';
import type { AuthService } from './modules/auth/auth.service.ts';
import { ratesRoutes } from './modules/rates/rates.routes.ts';
import type { RatesService } from './modules/rates/rates.service.ts';
import { expensesRoutes } from './modules/expenses/expenses.routes.ts';
import type { ExpenseService } from './modules/expenses/expenses.service.ts';
import type { SyncScheduler } from './modules/sync/sync.scheduler.ts';
import { syncRoutes } from './modules/sync/sync.routes.ts';
import type { SyncService } from './modules/sync/sync.service.ts';

export interface AppDependencies {
  expenseService: ExpenseService;
  auth: AuthService;
  rates: Pick<RatesService, 'snapshot' | 'currencies'>;
  idempotency: IdempotencyService;
  sync: SyncService;
  scheduler: SyncScheduler;
  /** Сколько ждать записи в Excel перед ответом на создание расхода */
  inlineExcelWaitMs?: number;
  currency?: string;
  /** За обратным прокси (Caddy): реальный IP и протокол берутся из X-Forwarded-* */
  trustProxy?: boolean;
  /** Дополнительные допустимые источники запросов (Origin) */
  allowedOrigins?: string[];
  logger?: FastifyServerOptions['logger'];
}

export function buildApp({
  expenseService,
  auth,
  rates,
  idempotency,
  sync,
  scheduler,
  inlineExcelWaitMs = 15_000,
  currency = 'AMD',
  trustProxy = false,
  allowedOrigins = [],
  logger = false,
}: AppDependencies): FastifyInstance {
  const app = Fastify({
    logger,
    trustProxy,
    // Короткий идентификатор запроса попадает во все строки лога и в заголовок ответа
    genReqId: () => randomUUID().slice(0, 8),
    logController: new LogController({ requestIdLogLabel: 'requestId' }),
  });

  // Клиенты часто шлют `Content-Type: application/json` и для запросов без тела (например, POST /api/sync).
  // Пустое тело допустимо, а битый JSON по-прежнему даёт 400.
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_request, body, done) => {
    if (body === '') return done(null, undefined);
    try {
      done(null, JSON.parse(body as string));
    } catch (error) {
      done(Object.assign(error as Error, { statusCode: 400 }), undefined);
    }
  });

  app.addHook('onSend', async (request, reply) => {
    reply.header('X-Request-Id', request.id);
  });

  app.setErrorHandler((rawError, request, reply) => {
    // Недоступная БД — это «попробуйте позже», а не внутренняя ошибка
    const error = isConnectionError(rawError) ? databaseUnavailableError(rawError) : rawError;

    // Для ошибок приложения строка лога уже записана в обработчике операции
    if (error instanceof AppError) {
      return reply
        .code(error.statusCode)
        .headers(error.headers ?? {})
        .send(errorBody(error.code, error.message));
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

  // Сначала разбор кук и проверки входа, затем маршруты: хуки должны подключиться раньше них
  app.register(authPlugin, { auth, allowedOrigins });

  app.get('/api/health', { config: { public: true } }, async () => ({ status: 'ok' }));
  app.get('/api/config', async () => ({ success: true, data: { currency } }));
  app.register(expensesRoutes({ expenseService, idempotency, sync, inlineExcelWaitMs }), {
    prefix: '/api',
  });
  app.register(ratesRoutes(rates), { prefix: '/api' });
  app.register(syncRoutes({ sync, scheduler }), { prefix: '/api' });
  app.register(authRoutes(auth), { prefix: '/api' });

  return app;
}

const errorBody = (code: string, message: string) => ({
  success: false,
  error: { code, message },
});

/** Коды сетевых ошибок Node и ошибок PostgreSQL «сервер недоступен / завершает работу». */
const CONNECTION_ERROR_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ENOTFOUND',
  'ETIMEDOUT',
  '57P01',
  '57P03',
  '08006',
  '08001',
]);

const isConnectionError = (error: unknown): boolean =>
  CONNECTION_ERROR_CODES.has((error as { code?: string })?.code ?? '');

import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { AppError, validationError } from '../../errors/app-error.ts';
import type { IdempotencyService } from '../../infrastructure/idempotency/idempotency.service.ts';
import type { SyncService } from '../sync/sync.service.ts';
import { createExpenseSchema, FIELD_ERROR_CODES } from './expenses.schema.ts';
import type { ExpenseService } from './expenses.service.ts';

const IDEMPOTENCY_KEY_FORMAT = /^[A-Za-z0-9_-]{8,128}$/;

export interface ExpensesRoutesDeps {
  expenseService: ExpenseService;
  idempotency: IdempotencyService;
  sync: Pick<SyncService, 'requestCycle' | 'enabled'>;
  /** Сколько ждать записи в Excel перед ответом. Дольше — расход остаётся в очереди. */
  inlineExcelWaitMs: number;
}

export const expensesRoutes =
  ({
    expenseService,
    idempotency,
    sync,
    inlineExcelWaitMs,
  }: ExpensesRoutesDeps): FastifyPluginAsync =>
  async (app) => {
    app.post('/expenses', async (request, reply) => {
      const startedAt = performance.now();
      // Ключи идемпотентности привязаны к id пользователя, а в расход и в лог пишем понятный логин
      const { id: userId, username } = request.user!;

      try {
        const key = readIdempotencyKey(request);
        const input = parseExpense(request.body);

        // Расход надёжно сохраняется в БД вместе с ключом идемпотентности
        const { value: saved, replayed } = await idempotency.run(
          { userId, key, payload: input },
          (tx) => expenseService.create(tx, input, username),
        );

        // Затем пробуем записать его в Excel. Если файл занят — расход ждёт в очереди.
        if (!replayed && sync.enabled) {
          await tryWriteToExcel(sync, inlineExcelWaitMs);
        }
        const excelStatus = sync.enabled
          ? await currentExcelStatus(expenseService, saved.id)
          : 'disabled';

        logOperation(request, {
          userId: username,
          startedAt,
          result: 'success',
          replayed,
          excelStatus,
        });
        return reply.code(replayed ? 200 : 201).send({
          success: true,
          data: {
            id: saved.id,
            date: saved.date,
            card: saved.card,
            category: saved.category,
            name: saved.name,
            amount: saved.amount,
            excelStatus,
          },
          message:
            excelStatus !== 'queued'
              ? 'Расход успешно добавлен'
              : 'Расход сохранён. В Excel он появится позже, когда файл освободится',
        });
      } catch (error) {
        logOperation(request, { userId: username, startedAt, result: 'error', error });
        throw error;
      }
    });

    app.get('/cards', async () => ({ success: true, data: expenseService.getCards() }));

    app.get('/categories', async () => ({
      success: true,
      data: await expenseService.getCategories(),
    }));
  };

/** Ждёт завершения синхронизации, но не дольше лимита. Ошибок не бросает: расход уже сохранён. */
async function tryWriteToExcel(
  sync: Pick<SyncService, 'requestCycle'>,
  waitMs: number,
): Promise<void> {
  const timeout = new Promise<void>((resolve) => setTimeout(resolve, waitMs).unref());
  await Promise.race([sync.requestCycle(), timeout]);
}

/** disabled — работа с Excel отключена. synced — запись уже в Excel, queued — ждёт (файл открыт, OneDrive недоступен или запись идёт). */
async function currentExcelStatus(
  service: ExpenseService,
  id: string,
): Promise<'synced' | 'queued'> {
  const current = await service.findById(id);
  return current?.excelStatus === 'synced' ? 'synced' : 'queued';
}

function readIdempotencyKey(request: FastifyRequest): string {
  const key = request.headers['idempotency-key'];

  if (typeof key !== 'string' || !key) {
    throw new AppError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Не указан заголовок Idempotency-Key');
  }
  if (!IDEMPOTENCY_KEY_FORMAT.test(key)) {
    throw new AppError(400, 'INVALID_IDEMPOTENCY_KEY', 'Некорректный Idempotency-Key');
  }
  return key;
}

function parseExpense(body: unknown) {
  const parsed = createExpenseSchema.safeParse(body);
  if (parsed.success) {
    return parsed.data;
  }

  const issue = parsed.error.issues[0]!;
  const code = FIELD_ERROR_CODES[String(issue.path[0])] ?? 'VALIDATION_ERROR';
  throw validationError(code, issue.message);
}

interface OperationLog {
  userId: string;
  startedAt: number;
  result: 'success' | 'error';
  replayed?: boolean;
  excelStatus?: 'synced' | 'queued' | 'disabled';
  error?: unknown;
}

/**
 * Одна строка аудита на операцию: кто, что, сколько заняло и чем закончилось.
 * Данные расхода (наименование, сумма) в лог не попадают.
 */
function logOperation(request: FastifyRequest, entry: OperationLog): void {
  const fields = {
    operation: 'expense.create',
    userId: entry.userId,
    durationMs: Math.round(performance.now() - entry.startedAt),
    result: entry.result,
    replayed: entry.replayed,
    excelStatus: entry.excelStatus,
  };

  if (entry.result === 'success') {
    request.log.info(fields, 'Operation completed');
    return;
  }

  const errorCode = entry.error instanceof AppError ? entry.error.code : 'INTERNAL_ERROR';
  request.log.warn({ ...fields, errorCode, err: entry.error }, 'Operation failed');
}

import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { AppError, validationError } from '../../errors/app-error.ts';
import type { IdempotencyService } from '../../infrastructure/idempotency/idempotency.service.ts';
import { waitForExcelWrite } from '../sync/inline-wait.ts';
import type { SyncService } from '../sync/sync.service.ts';
import { createExpenseSchema, FIELD_ERROR_CODES } from './expenses.schema.ts';
import type { ExpenseService } from './expenses.service.ts';

const IDEMPOTENCY_KEY_FORMAT = /^[A-Za-z0-9_-]{8,128}$/;

export interface ExpensesRoutesDeps {
  expenseService: ExpenseService;
  idempotency: IdempotencyService;
  sync: Pick<SyncService, 'requestCycle' | 'enabled'>;
  /** How long to wait for the Excel write before responding. Longer: the expense stays in the queue. */
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
      // Idempotency keys are bound to the user id, while the expense and the log get a readable login
      const { id: userId, username } = request.user!;

      try {
        const key = readIdempotencyKey(request);
        const input = parseExpense(request.body);

        // The expense is reliably saved to the DB together with the idempotency key
        const { value: saved, replayed } = await idempotency.run(
          { userId, key, payload: input },
          (tx) => expenseService.create(tx, input, username),
        );

        // Then we try to write it to Excel. If the file is busy, the expense waits in the queue.
        if (!replayed && sync.enabled) {
          await waitForExcelWrite(sync, inlineExcelWaitMs);
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
            original: saved.original,
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

    app.get('/name-suggestions', async () => ({
      success: true,
      data: await expenseService.getNameSuggestions(),
    }));

    app.get('/categories', async () => ({
      success: true,
      data: await expenseService.getCategories(),
    }));
  };

/** disabled — Excel is disabled. synced — the record is already in Excel, queued — waiting (file open, OneDrive unavailable, or a write in progress). */
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
 * One audit line per operation: who, what, how long it took and how it ended.
 * Expense data (name, amount) does not go into the log.
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

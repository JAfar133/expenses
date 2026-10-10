import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.ts';
import type { Database } from '../../src/infrastructure/database/database.ts';
import { IdempotencyService } from '../../src/infrastructure/idempotency/idempotency.service.ts';
import { ExpenseService } from '../../src/modules/expenses/expenses.service.ts';
import { SyncScheduler } from '../../src/modules/sync/sync.scheduler.ts';
import type { SyncService } from '../../src/modules/sync/sync.service.ts';
import type { SyncResult, SyncStatusView } from '../../src/modules/sync/sync.types.ts';
import { PostgresExpenseRepository } from '../../src/storage/postgres/postgres.repository.ts';

export const okResult = (overrides: Partial<SyncResult> = {}): SyncResult => ({
  startedAt: '2026-10-10T10:00:00.000Z',
  finishedAt: '2026-10-10T10:00:05.000Z',
  status: 'ok',
  imported: 0,
  written: 0,
  queued: 0,
  diverged: 0,
  skipped: 0,
  skippedRows: [],
  ...overrides,
});

/** Поддельная синхронизация: по запросу помечает очередь как записанную в Excel (или нет). */
export class FakeSync {
  cycles = 0;
  /** true — Excel доступен, очередь записывается; false — файл занят, записи остаются в очереди */
  excelAvailable = true;
  delayMs = 0;
  lastResult?: SyncResult;

  constructor(
    private readonly repository: PostgresExpenseRepository,
    private readonly database: Database,
  ) {}

  async requestCycle(): Promise<SyncResult> {
    this.cycles++;
    if (this.delayMs) await new Promise((resolve) => setTimeout(resolve, this.delayMs));

    if (this.excelAvailable) {
      const queue = await this.repository.listQueue(this.database);
      await this.repository.markSynced(
        this.database,
        queue.map((item) => item.id),
      );
      this.lastResult = okResult({ written: queue.length });
    } else {
      this.lastResult = okResult({ status: 'locked', queued: await this.repository.countQueue() });
    }
    return this.lastResult;
  }

  async status(): Promise<SyncStatusView> {
    return {
      lastResult: this.lastResult,
      queued: await this.repository.countQueue(),
      running: false,
    };
  }
}

export interface TestApp {
  app: FastifyInstance;
  database: Database;
  repository: PostgresExpenseRepository;
  sync: FakeSync;
  scheduler: SyncScheduler;
}

export function createTestApp(
  database: Database,
  options: { inlineExcelWaitMs?: number } = {},
): TestApp {
  const repository = new PostgresExpenseRepository(database);
  const sync = new FakeSync(repository, database);
  const scheduler = new SyncScheduler({ sync, intervalMs: 300_000, retryMs: 60_000 });

  const app = buildApp({
    expenseService: new ExpenseService(repository, {
      reference: { cards: ['Миша', 'Настя'], categories: ['кафе', 'продукты'] },
    }),
    idempotency: new IdempotencyService(database),
    sync: sync as unknown as SyncService,
    scheduler,
    inlineExcelWaitMs: options.inlineExcelWaitMs ?? 1000,
  });
  return { app, database, repository, sync, scheduler };
}

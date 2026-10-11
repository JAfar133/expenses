import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from 'fastify';
import { buildApp } from '../../src/app.ts';
import { AuthRepository } from '../../src/modules/auth/auth.repository.ts';
import { AuthService } from '../../src/modules/auth/auth.service.ts';
import { LoginThrottle } from '../../src/modules/auth/login-throttle.ts';
import { hashPassword } from '../../src/modules/auth/password.ts';
import { generateToken, hashToken } from '../../src/modules/auth/tokens.ts';
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
  deleted: 0,
  restored: 0,
  deletionsBlocked: 0,
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
  /** Параметры последнего запрошенного цикла */
  lastOptions?: { applyDeletions?: boolean };
  lastResult?: SyncResult;

  constructor(
    private readonly repository: PostgresExpenseRepository,
    private readonly database: Database,
  ) {}

  /** false: имитирует отсутствие ONEDRIVE_FILE_PATH */
  enabled = true;

  async requestCycle(options: { applyDeletions?: boolean } = {}): Promise<SyncResult> {
    this.cycles++;
    this.lastOptions = options;
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
      enabled: this.enabled,
      lastResult: this.lastResult,
      queued: await this.repository.countQueue(),
      running: false,
    };
  }
}

/** Поддельные курсы: драммы за единицу валюты; убрав курс, можно имитировать недоступный источник. */
export class FakeRates {
  readonly base = 'AMD';
  readonly currencies = ['AMD', 'RUB', 'USD', 'EUR'];
  rates = new Map<string, number>([
    ['RUB', 4.5],
    ['USD', 380],
    ['EUR', 410],
  ]);

  async rateOf(currency: string) {
    return currency === this.base ? 1 : this.rates.get(currency);
  }

  async snapshot() {
    return {
      base: this.base,
      rates: [...this.rates].map(([currency, rate]) => ({
        currency,
        rate,
        fetchedAt: '2026-10-10T10:00:00.000Z',
      })),
    };
  }
}

/** Пароль обоих тестовых пользователей. */
export const TEST_PASSWORD = 'shared-test-password-1';

export type TestUsername = 'misha' | 'nastya';

/** Хеш считается один раз на весь прогон: scrypt специально медленный. */
let sharedPasswordHash: Promise<string> | undefined;
const passwordHash = () => (sharedPasswordHash ??= hashPassword(TEST_PASSWORD));

export interface TestApp {
  app: FastifyInstance;
  database: Database;
  repository: PostgresExpenseRepository;
  sync: FakeSync;
  rates: FakeRates;
  scheduler: SyncScheduler;
  auth: AuthService;
  authRepository: AuthRepository;
  /** Запрос от имени вошедшего пользователя (по умолчанию misha): с куками входа и заголовком Origin сайта */
  inject: (options: InjectOptions, as?: TestUsername) => Promise<LightMyRequestResponse>;
  /** Куки входа для пользователя: создаёт сессию напрямую, без проверки пароля */
  sessionCookies: (username: TestUsername) => Promise<{ et_access: string; et_refresh: string }>;
}

export interface TestAppOptions {
  inlineExcelWaitMs?: number;
  trustProxy?: boolean;
  allowedOrigins?: string[];
  throttle?: LoginThrottle;
}

export const TEST_ORIGIN = 'http://localhost';

export async function createTestApp(
  database: Database,
  options: TestAppOptions = {},
): Promise<TestApp> {
  const repository = new PostgresExpenseRepository(database);
  const sync = new FakeSync(repository, database);
  const rates = new FakeRates();
  const scheduler = new SyncScheduler({ sync, intervalMs: 300_000, retryMs: 60_000 });

  const authRepository = new AuthRepository(database);
  const auth = new AuthService({
    repository: authRepository,
    config: {
      accessTtlMs: 24 * 3_600_000,
      refreshTtlMs: 7 * 24 * 3_600_000,
      sessionMaxMs: 30 * 24 * 3_600_000,
      rotationGraceMs: 15_000,
      minPasswordLength: 12,
    },
    throttle: options.throttle,
  });
  for (const [username, card] of [
    ['misha', 'Миша'],
    ['nastya', 'Настя'],
  ] as const) {
    await authRepository.upsertUser(username, card);
    const user = await authRepository.findUser(username);
    await authRepository.setPasswordHash(user!.id, await passwordHash());
  }

  const app = buildApp({
    expenseService: new ExpenseService(repository, {
      reference: { cards: ['Миша', 'Настя'], categories: ['кафе', 'продукты'] },
      currency: rates,
    }),
    auth,
    rates,
    idempotency: new IdempotencyService(database),
    sync: sync as unknown as SyncService,
    scheduler,
    inlineExcelWaitMs: options.inlineExcelWaitMs ?? 1000,
    trustProxy: options.trustProxy,
    allowedOrigins: options.allowedOrigins,
  });

  const sessionCookies: TestApp['sessionCookies'] = async (username) => {
    const user = await authRepository.findUser(username);
    const [accessToken, refreshToken] = [generateToken(), generateToken()];
    await authRepository.createSession(
      {
        userId: user!.id,
        accessHash: hashToken(accessToken),
        accessExpiresAt: new Date(Date.now() + 24 * 3_600_000),
        refreshHash: hashToken(refreshToken),
        refreshExpiresAt: new Date(Date.now() + 7 * 24 * 3_600_000),
        createdAt: new Date(),
      },
      {},
    );
    return { et_access: accessToken, et_refresh: refreshToken };
  };

  const cookiesByUser = new Map<TestUsername, Promise<{ et_access: string; et_refresh: string }>>();

  const inject: TestApp['inject'] = async (injectOptions, as = 'misha') => {
    if (!cookiesByUser.has(as)) cookiesByUser.set(as, sessionCookies(as));
    const cookies = await cookiesByUser.get(as)!;
    return app.inject({
      ...injectOptions,
      cookies: { ...cookies, ...injectOptions.cookies },
      headers: { origin: TEST_ORIGIN, ...injectOptions.headers },
    });
  };

  return {
    app,
    database,
    repository,
    sync,
    rates,
    scheduler,
    auth,
    authRepository,
    inject,
    sessionCookies,
  };
}

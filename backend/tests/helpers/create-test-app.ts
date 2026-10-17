import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from 'fastify';
import { buildApp } from '../../src/app.ts';
import { AuthRepository } from '../../src/modules/auth/auth.repository.ts';
import { AuthService } from '../../src/modules/auth/auth.service.ts';
import { LoginThrottle } from '../../src/modules/auth/login-throttle.ts';
import { hashPassword } from '../../src/modules/auth/password.ts';
import { generateToken, hashToken } from '../../src/modules/auth/tokens.ts';
import type { Database } from '../../src/infrastructure/database/database.ts';
import { IdempotencyService } from '../../src/infrastructure/idempotency/idempotency.service.ts';
import { AnalyticsRepository } from '../../src/modules/analytics/analytics.repository.ts';
import { AnalyticsService } from '../../src/modules/analytics/analytics.service.ts';
import { PreferencesRepository } from '../../src/modules/preferences/preferences.repository.ts';
import { ensureDefaultGroup } from '../../src/modules/groups/default-group.ts';
import { GroupAdminRepository } from '../../src/modules/groups/group-admin.repository.ts';
import { GroupService } from '../../src/modules/groups/group.service.ts';
import { InvitationsService } from '../../src/modules/groups/invitations.service.ts';
import { PlatformAdminService } from '../../src/modules/groups/platform-admin.service.ts';
import { GroupsRepository } from '../../src/modules/groups/groups.repository.ts';
import { ExpenseEditor } from '../../src/modules/expenses/expense-editor.ts';
import { ExpenseService } from '../../src/modules/expenses/expenses.service.ts';
import type { BackupStatusService } from '../../src/modules/admin/backup-status.service.ts';
import { createAiModule } from '../../src/modules/ai/ai.module.ts';
import { FakeProvider } from '../../src/modules/llm/providers/fake.provider.ts';
import { BudgetsRepository } from '../../src/modules/budgets/budgets.repository.ts';
import { ReceiptsRepository } from '../../src/modules/receipts/receipts.repository.ts';
import { ReceiptsService } from '../../src/modules/receipts/receipts.service.ts';
import { ReceiptStore } from '../../src/modules/receipts/receipts.store.ts';
import { BudgetsService } from '../../src/modules/budgets/budgets.service.ts';
import { createBankImportModule } from '../../src/modules/bank-import/bank-import.module.ts';
import { TemplatesRepository } from '../../src/modules/templates/templates.repository.ts';
import { TemplatesService } from '../../src/modules/templates/templates.service.ts';
import { ReportService } from '../../src/modules/reports/report.service.ts';
import { SyncSwitch } from '../../src/modules/sync/sync-switch.ts';
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
  updated: 0,
  removed: 0,
  queued: 0,
  deleted: 0,
  restored: 0,
  deletionsBlocked: 0,
  skipped: 0,
  skippedRows: [],
  ...overrides,
});

/** Fake sync: on request marks the queue as written to Excel (or not). */
export class FakeSync {
  cycles = 0;
  /** true: Excel is available, the queue is written; false: the file is busy, records stay queued */
  excelAvailable = true;
  delayMs = 0;
  /** Parameters of the last requested cycle */
  lastOptions?: { applyDeletions?: boolean };
  lastResult?: SyncResult;

  constructor(
    private readonly repository: PostgresExpenseRepository,
    private readonly database: Database,
  ) {}

  /** false: simulates a missing ONEDRIVE_FILE_PATH */
  enabled = true;
  /** The part the administrator's switch uses */
  get configured() {
    return true;
  }
  setEnabled(enabled: boolean) {
    this.enabled = enabled;
  }

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

/** Fake rates: drams per unit of currency; removing a rate simulates an unavailable source. */
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

/** Password of both test users. */
export const TEST_PASSWORD = 'shared-test-password-1';

/** misha and nastya exist in every test app; a test can create other logins (see groups.access.test.ts) */
export type TestUsername = 'misha' | 'nastya' | (string & {});

/** The hash is computed once per run: scrypt is deliberately slow. */
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
  invitations: InvitationsService;
  /** The AI provider of the app: tests put its answers in `answers` and read `calls` */
  llmProvider: FakeProvider;
  /** A request as the logged-in user (misha by default): with login cookies and the site Origin header */
  inject: (options: InjectOptions, as?: TestUsername) => Promise<LightMyRequestResponse>;
  /** Login cookies for a user: creates a session directly, without checking the password */
  sessionCookies: (username: TestUsername) => Promise<{ et_access: string; et_refresh: string }>;
}

export interface TestAppOptions {
  inlineExcelWaitMs?: number;
  trustProxy?: boolean;
  allowedOrigins?: string[];
  throttle?: LoginThrottle;
  checkDatabase?: () => Promise<unknown>;
  /** The backup status for the administrator */
  backupStatus?: BackupStatusService;
  /** Row limit of the Excel report */
  maxReportRows?: number;
  /** Request limits of the notification import endpoint */
  importLimits?: { perKey: number; badKeysPerAddress: number };
  /** Clock of the invitations service */
  now?: () => Date;
  /** Folder of receipt photos (a temporary folder by default) */
  receiptsDir?: string;
}

/** "Today" in tests: a fixed date so calculations do not depend on the calendar. */
export const TEST_TODAY = '2026-10-15';

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
    // Edit permission by default only for misha (like the default EDITOR_USERS)
    await authRepository.upsertUser(username, card, {
      canEdit: username === 'misha',
      timezone: 'Asia/Yerevan',
    });
    const user = await authRepository.findUser(username);
    await authRepository.setPasswordHash(user!.id, await passwordHash());
  }

  // Like the first start of the app: one group, misha is the owner, nastya a member with access to every card
  await ensureDefaultGroup(database, {
    name: 'Семья',
    currency: 'AMD',
    timezone: 'Asia/Yerevan',
    cards: ['Миша', 'Настя'],
    categories: ['кафе', 'продукты'],
    admins: ['misha'],
  });
  const groups = new GroupsRepository(database);
  const invitations = new InvitationsService({
    database,
    minPasswordLength: 12,
    now: options.now,
  });

  const analyticsRepository = new AnalyticsRepository(database, 'AMD');
  const budgetsRepository = new BudgetsRepository(database);
  const analytics = new AnalyticsService({
    repository: analyticsRepository,
    today: () => TEST_TODAY,
  });
  const syncSwitch = new SyncSwitch(database, sync, scheduler);
  const receiptsRepository = new ReceiptsRepository(database);
  const receipts = new ReceiptsService({
    repository: receiptsRepository,
    store: new ReceiptStore(options.receiptsDir ?? mkdtempSync(path.join(tmpdir(), 'receipts-'))),
    groups,
    now: options.now,
  });
  const editor = new ExpenseEditor({ database, repository, groups, now: options.now });
  const llmProvider = new FakeProvider();
  const ai = createAiModule({
    database,
    expenses: repository,
    editor,
    receipts,
    receiptsRepository,
    provider: llmProvider,
    secretsKey: 'test-secrets-key-test-secrets-key-1234',
    defaults: { model: 'test-model', dailyLimit: 30 },
    now: options.now,
  });

  const expenseService = new ExpenseService(repository, {
    groups,
    currency: rates,
    items: ai.items,
    aiParse: ai.aiParse,
  });
  const bankImport = createBankImportModule({
    database,
    expenses: expenseService,
    editor,
    groups,
    sync,
    limits: options.importLimits,
  });

  const app = buildApp({
    syncSwitch,
    now: options.now,
    backupStatus: options.backupStatus,
    expenseService,
    bankImport,
    groups,
    invitations,
    receipts,
    templates: new TemplatesService({
      repository: new TemplatesRepository(database),
      groups,
      currencies: ['AMD', 'USD', 'RUB', 'EUR'],
    }),
    ai,
    budgets: new BudgetsService({
      repository: budgetsRepository,
      analytics: analyticsRepository,
      currencies: {
        reportingCurrency: (groupId) => groups.reportingCurrency(groupId),
        rateOf: (currency) => rates.rateOf(currency),
        available: ['AMD', 'USD', 'RUB', 'EUR'],
      },
      now: options.now,
    }),
    groupService: new GroupService(
      new GroupAdminRepository(database),
      invitations,
      auth,
      {
        currencies: ['AMD', 'USD', 'RUB', 'EUR'],
        base: 'AMD',
        rateOf: (currency) => rates.rateOf(currency),
      },
      budgetsRepository,
    ),
    platformAdmin: new PlatformAdminService({
      database,
      invitations,
      currencies: ['AMD', 'USD', 'RUB'],
      defaultCurrency: 'AMD',
      defaultTimezone: 'Asia/Yerevan',
      defaultCategories: ['кафе', 'продукты'],
    }),
    auth,
    rates,
    analytics,
    report: new ReportService(analytics, { base: 'AMD', maxRows: options.maxReportRows }),
    preferences: new PreferencesRepository(database),
    editor,
    idempotency: new IdempotencyService(database),
    sync: sync as unknown as SyncService,
    scheduler,
    inlineExcelWaitMs: options.inlineExcelWaitMs ?? 1000,
    checkDatabase: options.checkDatabase,
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
    invitations,
    llmProvider,
    inject,
    sessionCookies,
  };
}

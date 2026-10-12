import 'dotenv/config';
import { buildApp } from './app.ts';
import { loadEnv, readUserPasswords } from './config/env.ts';
import { BackupService } from './infrastructure/backup/backup.service.ts';
import { createPostgresDatabase, waitForDatabase } from './infrastructure/database/database.ts';
import { GroupAdminRepository } from './modules/groups/group-admin.repository.ts';
import { GroupService } from './modules/groups/group.service.ts';
import { GroupsRepository } from './modules/groups/groups.repository.ts';
import { InvitationsService } from './modules/groups/invitations.service.ts';
import { PlatformAdminService } from './modules/groups/platform-admin.service.ts';
import { ensureDefaultGroup } from './modules/groups/default-group.ts';
import { migrate } from './infrastructure/database/migrate.ts';
import { IdempotencyService } from './infrastructure/idempotency/idempotency.service.ts';
import { AnalyticsRepository } from './modules/analytics/analytics.repository.ts';
import { AnalyticsService } from './modules/analytics/analytics.service.ts';
import { todayIn } from './modules/analytics/date-math.ts';
import { AuthRepository } from './modules/auth/auth.repository.ts';
import { AuthService } from './modules/auth/auth.service.ts';
import { ExpenseEditor } from './modules/expenses/expense-editor.ts';
import { ExpenseService } from './modules/expenses/expenses.service.ts';
import { createCbaClient } from './modules/rates/cba-client.ts';
import { PreferencesRepository } from './modules/preferences/preferences.repository.ts';
import { RatesRepository } from './modules/rates/rates.repository.ts';
import { RatesService } from './modules/rates/rates.service.ts';
import { SyncScheduler } from './modules/sync/sync.scheduler.ts';
import { SyncService } from './modules/sync/sync.service.ts';
import { SyncStateRepository } from './modules/sync/sync-state.repository.ts';
import { RcloneOneDriveService } from './services/onedrive.service.ts';
import { CliRcloneClient } from './services/onedrive/cli-client.ts';
import { RcdRcloneClient } from './services/onedrive/rcd-client.ts';
import { RcloneDaemon } from './services/onedrive/rcd-daemon.ts';
import type { RcloneClient } from './services/onedrive/rclone-client.ts';
import { PostgresExpenseRepository } from './storage/postgres/postgres.repository.ts';

const DAY_MS = 86_400_000;

const env = loadEnv();

// --- OneDrive via rclone (only if an Excel file is set)
const rclone = env.ONEDRIVE_FILE_PATH ? createRclone(env.ONEDRIVE_FILE_PATH) : undefined;

function createRclone(filePath: string) {
  const daemon =
    env.RCLONE_MODE === 'daemon'
      ? new RcloneDaemon({
          configPath: env.RCLONE_CONFIG,
          logger: {
            info: (message) => app.log.info(message),
            warn: (message) => app.log.warn(message),
          },
        })
      : undefined;

  const client: RcloneClient = daemon
    ? new RcdRcloneClient(daemon, env.RCLONE_TIMEOUT_MS)
    : new CliRcloneClient({ configPath: env.RCLONE_CONFIG, timeoutMs: env.RCLONE_TIMEOUT_MS });

  const oneDrive = new RcloneOneDriveService({
    remote: env.ONEDRIVE_REMOTE,
    filePath,
    client,
  });
  return { daemon, oneDrive };
}

const backups = new BackupService({
  dir: env.BACKUP_DIR,
  retentionDays: env.BACKUP_RETENTION_DAYS,
  timezone: env.APP_TIMEZONE,
});

// --- PostgreSQL
const database = createPostgresDatabase(env.DATABASE_URL, (error) =>
  app.log.error({ err: error }, 'PostgreSQL connection error'),
);
const expenses = new PostgresExpenseRepository(database);
const groups = new GroupsRepository(database);
const invitations = new InvitationsService({
  database,
  minPasswordLength: env.AUTH_MIN_PASSWORD_LENGTH,
});
const idempotency = new IdempotencyService(database);

const HOUR_MS = 3_600_000;
const rates = new RatesService({
  repository: new RatesRepository(database),
  fetchRates: createCbaClient({ url: env.EXCHANGE_RATES_URL }),
  base: env.DEFAULT_CURRENCY,
  currencies: env.CURRENCIES,
  refreshMs: env.EXCHANGE_RATES_REFRESH_HOURS * HOUR_MS,
  logger: { warn: (fields, message) => app.log.warn(fields, message) },
});
const auth = new AuthService({
  repository: new AuthRepository(database),
  config: {
    accessTtlMs: env.ACCESS_TOKEN_TTL_HOURS * HOUR_MS,
    refreshTtlMs: env.REFRESH_TOKEN_TTL_DAYS * 24 * HOUR_MS,
    sessionMaxMs: env.SESSION_MAX_DAYS * 24 * HOUR_MS,
    rotationGraceMs: 15_000,
    minPasswordLength: env.AUTH_MIN_PASSWORD_LENGTH,
  },
  logger: { warn: (fields, message) => app.log.warn(fields, message) },
});

const analytics = new AnalyticsService({
  repository: new AnalyticsRepository(database, env.DEFAULT_CURRENCY),
  today: (timezone) => todayIn(timezone),
});

const sync = new SyncService({
  database,
  expenses,
  oneDrive: rclone?.oneDrive,
  backups,
  excelOptions: { sheetName: env.EXCEL_SHEET_NAME, tableName: env.EXCEL_TABLE_NAME },
  state: new SyncStateRepository(database),
  maxDeletePercent: env.SYNC_MAX_DELETE_PERCENT,
  logger: {
    info: (fields, message) => app.log.info(fields, message),
    warn: (fields, message) => app.log.warn(fields, message),
  },
});

const scheduler = new SyncScheduler({
  sync,
  intervalMs: env.SYNC_INTERVAL_MINUTES * 60_000,
  retryMs: env.SYNC_RETRY_SECONDS * 1000,
});

const app = buildApp({
  currency: env.DEFAULT_CURRENCY,
  logger: {
    level: env.NODE_ENV === 'production' ? 'info' : 'debug',
    redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
  },
  auth,
  rates,
  analytics,
  preferences: new PreferencesRepository(database),
  editor: new ExpenseEditor({ database, repository: expenses, groups }),
  groups,
  invitations,
  groupService: new GroupService(new GroupAdminRepository(database), invitations, auth),
  platformAdmin: new PlatformAdminService({
    database,
    invitations,
    currencies: env.CURRENCIES,
    defaultCurrency: env.DEFAULT_CURRENCY,
    defaultTimezone: env.APP_TIMEZONE,
    defaultCategories: env.CATEGORIES,
  }),
  checkDatabase: () => database.query('SELECT 1'),
  trustProxy: env.TRUST_PROXY,
  allowedOrigins: env.ALLOWED_ORIGINS,
  idempotency,
  sync,
  scheduler,
  inlineExcelWaitMs: env.SYNC_INLINE_WAIT_SECONDS * 1000,
  expenseService: new ExpenseService(expenses, {
    groups,
    currency: {
      base: env.DEFAULT_CURRENCY,
      currencies: env.CURRENCIES,
      rateOf: (currency) => rates.rateOf(currency),
    },
    logger: { warn: (object, message) => app.log.warn(object, message) },
  }),
});

/** Removes stale backups and idempotency keys. */
async function runMaintenance(): Promise<void> {
  const removedBackups = await backups.cleanup();
  const removedSessions = await auth.deleteStaleSessions();
  const removedKeys = await idempotency.deleteOlderThan(
    new Date(Date.now() - env.BACKUP_RETENTION_DAYS * DAY_MS),
  );
  app.log.info({ removedBackups, removedKeys, removedSessions }, 'Maintenance completed');
}

await waitForDatabase(database, {
  onRetry: () => app.log.warn('Waiting for the database to accept connections...'),
});

const applied = await migrate(database);
if (applied.length > 0) {
  app.log.info({ migrations: applied }, 'Database migrations applied');
}

// Users and passwords come from the settings. A password is hashed and stored in the database if it is new or has changed.
const userSync = await auth.syncUsers(env.AUTH_USERS, readUserPasswords(env.AUTH_USERS), {
  editors: env.EDITOR_USERS,
  timezone: env.APP_TIMEZONE,
});
const group = await ensureDefaultGroup(database, {
  name: env.DEFAULT_GROUP_NAME,
  currency: env.DEFAULT_CURRENCY,
  timezone: env.APP_TIMEZONE,
  cards: env.CARDS,
  categories: env.CATEGORIES,
  admins: env.ADMIN_USERS,
});
if (group.created || group.assigned > 0) {
  app.log.info(group, 'Default group prepared');
}
if (userSync.passwordsUpdated.length > 0) {
  app.log.info({ users: userSync.passwordsUpdated }, 'User passwords updated');
}
if (userSync.withoutPassword.length > 0) {
  app.log.warn(
    { users: userSync.withoutPassword },
    'Users have no password and cannot log in: set AUTH_PASSWORD_<LOGIN>',
  );
}
const unknownCards = env.AUTH_USERS.filter((user) => !env.CARDS.includes(user.card));
if (unknownCards.length > 0) {
  app.log.warn({ users: unknownCards }, 'AUTH_USERS contains cards that are not in CARDS');
}

await app.listen({ host: env.HOST, port: env.PORT });

// The first sync starts immediately: it pulls in the Excel rows and appends the queue
if (sync.enabled) {
  scheduler.start();
} else {
  app.log.info(
    'ONEDRIVE_FILE_PATH is not set: Excel sync is disabled, expenses are stored in the database only',
  );
}

await runMaintenance().catch((error) => app.log.error({ err: error }, 'Maintenance failed'));
setInterval(
  () => void runMaintenance().catch((error) => app.log.error({ err: error }, 'Maintenance failed')),
  DAY_MS,
).unref();

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, async () => {
    scheduler.stop();
    await app.close();
    await rclone?.daemon?.stop();
    await database.close();
    process.exit(0);
  });
}

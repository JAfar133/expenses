import 'dotenv/config';
import { buildApp } from './app.ts';
import { loadEnv } from './config/env.ts';
import { BackupService } from './infrastructure/backup/backup.service.ts';
import { createPostgresDatabase, waitForDatabase } from './infrastructure/database/database.ts';
import { migrate } from './infrastructure/database/migrate.ts';
import { IdempotencyService } from './infrastructure/idempotency/idempotency.service.ts';
import { ExpenseService } from './modules/expenses/expenses.service.ts';
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

// --- OneDrive через rclone
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
  filePath: env.ONEDRIVE_FILE_PATH,
  client,
});

const backups = new BackupService({
  dir: env.BACKUP_DIR,
  retentionDays: env.BACKUP_RETENTION_DAYS,
  timezone: env.APP_TIMEZONE,
});

// --- PostgreSQL
const database = createPostgresDatabase(env.DATABASE_URL);
const expenses = new PostgresExpenseRepository(database);
const idempotency = new IdempotencyService(database);

const sync = new SyncService({
  database,
  expenses,
  oneDrive,
  backups,
  excelOptions: { sheetName: env.EXCEL_SHEET_NAME, tableName: env.EXCEL_TABLE_NAME },
  state: new SyncStateRepository(database),
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
  idempotency,
  sync,
  scheduler,
  inlineExcelWaitMs: env.SYNC_INLINE_WAIT_SECONDS * 1000,
  expenseService: new ExpenseService(expenses, {
    reference: { cards: env.CARDS, categories: env.CATEGORIES },
    logger: { warn: (object, message) => app.log.warn(object, message) },
  }),
});

/** Удаляет устаревшие резервные копии и ключи идемпотентности. */
async function runMaintenance(): Promise<void> {
  const removedBackups = await backups.cleanup();
  const removedKeys = await idempotency.deleteOlderThan(
    new Date(Date.now() - env.BACKUP_RETENTION_DAYS * DAY_MS),
  );
  app.log.info({ removedBackups, removedKeys }, 'Maintenance completed');
}

await waitForDatabase(database, {
  onRetry: () => app.log.warn('Waiting for the database to accept connections...'),
});

const applied = await migrate(database);
if (applied.length > 0) {
  app.log.info({ migrations: applied }, 'Database migrations applied');
}

await app.listen({ host: env.HOST, port: env.PORT });

// Первая синхронизация стартует сразу: подтянет строки Excel и допишет очередь
scheduler.start();

await runMaintenance().catch((error) => app.log.error({ err: error }, 'Maintenance failed'));
setInterval(
  () => void runMaintenance().catch((error) => app.log.error({ err: error }, 'Maintenance failed')),
  DAY_MS,
).unref();

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, async () => {
    scheduler.stop();
    await app.close();
    await daemon?.stop();
    await database.close();
    process.exit(0);
  });
}

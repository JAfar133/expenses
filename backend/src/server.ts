import 'dotenv/config';
import { buildApp } from './app.ts';
import { loadEnv } from './config/env.ts';
import { ExpenseService } from './modules/expenses/expenses.service.ts';
import { RcloneOneDriveService } from './services/onedrive.service.ts';
import { createRcloneRunner } from './services/onedrive/rclone-runner.ts';
import { ExcelExpenseRepository } from './storage/excel/excel.repository.ts';

const env = loadEnv();

const oneDrive = new RcloneOneDriveService({
  remote: env.ONEDRIVE_REMOTE,
  filePath: env.ONEDRIVE_FILE_PATH,
  run: createRcloneRunner({ configPath: env.RCLONE_CONFIG, timeoutMs: env.RCLONE_TIMEOUT_MS }),
});

const repository = new ExcelExpenseRepository(oneDrive, {
  sheetName: env.EXCEL_SHEET_NAME,
  tableName: env.EXCEL_TABLE_NAME,
});

const app = buildApp({
  logger: { level: env.NODE_ENV === 'production' ? 'info' : 'debug' },
  expenseService: new ExpenseService(repository, {
    reference: { cards: env.CARDS, categories: env.CATEGORIES },
    logger: { warn: (object, message) => app.log.warn(object, message) },
  }),
});

await app.listen({ host: env.HOST, port: env.PORT });

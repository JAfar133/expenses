import { readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { BackupStore } from '../../infrastructure/backup/backup.service.ts';
import type { Database } from '../../infrastructure/database/database.ts';
import { appendExpensesToBuffer, readExcelExpenses } from '../../services/excel.service.ts';
import type { ExcelOptions } from '../../services/excel/types.ts';
import { OneDriveError } from '../../services/onedrive/errors.ts';
import type { DownloadedFile, OneDriveService } from '../../services/onedrive/types.ts';
import type { ExpenseRepository, StoredExpense } from '../../storage/expense.repository.ts';
import { reconcile } from './reconcile.ts';
import { describeSyncError } from './sync-errors.ts';
import type { SyncStateRepository } from './sync-state.repository.ts';
import type { SyncResult, SyncStatusView } from './sync.types.ts';

export interface SyncServiceDeps {
  database: Database;
  expenses: ExpenseRepository;
  oneDrive: OneDriveService;
  backups: BackupStore;
  excelOptions: ExcelOptions;
  state: SyncStateRepository;
  logger?: {
    info: (fields: object, message: string) => void;
    warn: (fields: object, message: string) => void;
  };
}

/** Сколько раз подряд повторяем цикл, если файл изменили прямо во время записи. */
const MAX_CONFLICT_ATTEMPTS = 2;

/**
 * Синхронизация PostgreSQL ↔ Excel. За один цикл:
 *   1. скачиваем свежий Excel;
 *   2. строки, которых нет в БД (добавлены в Excel вручную), добавляем в БД;
 *   3. записи из очереди (ещё не попавшие в Excel) дописываем в Excel и загружаем файл.
 *
 * Цикл всегда один за раз. Запросы, пришедшие во время работы цикла, объединяются в один
 * следующий цикл: он стартует после запроса, поэтому видит все записи, добавленные до него.
 */
export class SyncService {
  private running?: Promise<SyncResult>;
  private next?: Promise<SyncResult>;
  private lastResult?: SyncResult;

  constructor(private readonly deps: SyncServiceDeps) {}

  get isRunning(): boolean {
    return this.running !== undefined;
  }

  /** Запускает цикл (или присоединяется к ожидающему). Не бросает ошибок: итог — в результате. */
  requestCycle(): Promise<SyncResult> {
    if (!this.running) {
      return this.start();
    }

    this.next ??= this.running.then(() => {
      this.next = undefined;
      return this.start();
    });
    return this.next;
  }

  async status(): Promise<SyncStatusView> {
    this.lastResult ??= await this.deps.state.get();
    return {
      lastResult: this.lastResult,
      queued: await this.deps.expenses.countQueue(),
      running: this.isRunning,
    };
  }

  private start(): Promise<SyncResult> {
    const run = this.runWithConflictRetry().finally(() => {
      if (this.running === run) this.running = undefined;
    });
    this.running = run;
    return run;
  }

  private async runWithConflictRetry(): Promise<SyncResult> {
    let result = await this.runCycle();
    for (
      let attempt = 1;
      attempt < MAX_CONFLICT_ATTEMPTS && result.error?.code === 'VERSION_CONFLICT';
      attempt++
    ) {
      result = await this.runCycle();
    }

    this.lastResult = result;
    await this.deps.state
      .save(result)
      .catch((error) => this.deps.logger?.warn({ err: error }, 'Failed to save sync state'));
    this.deps.logger?.info(
      {
        operation: 'sync',
        status: result.status,
        imported: result.imported,
        written: result.written,
        queued: result.queued,
        diverged: result.diverged,
        skipped: result.skipped,
        errorCode: result.error?.code,
      },
      'Sync finished',
    );
    return result;
  }

  private async runCycle(): Promise<SyncResult> {
    const result: SyncResult = {
      startedAt: new Date().toISOString(),
      finishedAt: '',
      status: 'ok',
      imported: 0,
      written: 0,
      queued: 0,
      diverged: 0,
      skipped: 0,
      skippedRows: [],
    };

    try {
      await this.syncOnce(result);
    } catch (error) {
      const { status, code, message } = describeSyncError(error);
      result.status = status;
      result.error = { code, message };
      this.deps.logger?.warn({ err: error, errorCode: code }, 'Sync cycle failed');
    }

    result.queued = await this.deps.expenses.countQueue().catch(() => 0);
    result.finishedAt = new Date().toISOString();
    return result;
  }

  private async syncOnce(result: SyncResult): Promise<void> {
    const file = await this.deps.oneDrive.downloadFile();

    try {
      const source = await readFile(file.localPath);
      await this.importFromExcel(source, result);
      await this.writeQueueToExcel(file, source, result);
    } finally {
      await rm(dirname(file.localPath), { recursive: true, force: true });
    }
  }

  /** Шаг 2: сверка и импорт строк, добавленных в Excel вручную. */
  private async importFromExcel(source: Buffer, result: SyncResult): Promise<void> {
    const excel = await readExcelExpenses(source, this.deps.excelOptions);
    const { expenses } = this.deps;

    const { imported, diverged } = await this.deps.database.transaction(async (tx) => {
      const plan = reconcile(excel.expenses, await expenses.listForReconcile(tx));

      await expenses.markSynced(tx, plan.promoteToSynced);
      await expenses.markPending(tx, plan.revertToPending);
      return {
        imported: await expenses.importFromExcel(tx, plan.toImport),
        diverged: plan.diverged,
      };
    });

    result.imported = imported;
    result.diverged = diverged;
    result.skipped = excel.skippedCount;
    result.skippedRows = excel.skipped;
  }

  /** Шаг 3: дописывание очереди в Excel. */
  private async writeQueueToExcel(
    file: DownloadedFile,
    source: Buffer,
    result: SyncResult,
  ): Promise<void> {
    const { expenses, database } = this.deps;
    const queue = await expenses.listQueue(database);
    if (queue.length === 0) return;

    const ids = queue.map((item) => item.id);
    const resultPath = await this.prepareFile(file, source, queue);

    // «writing» фиксируем до загрузки: если процесс упадёт после неё, следующая сверка
    // поймёт по содержимому Excel, дошла ли запись, и не создаст дубль.
    await expenses.markWriting(database, ids);

    try {
      await this.deps.oneDrive.uploadFile(resultPath, file.version);
    } catch (error) {
      await this.handleUploadFailure(error, ids);
      throw error;
    }

    await expenses.markSynced(database, ids);
    result.written = ids.length;
  }

  /** Резервная копия и новый файл с добавленными записями. До загрузки БД не меняется. */
  private async prepareFile(
    file: DownloadedFile,
    source: Buffer,
    queue: StoredExpense[],
  ): Promise<string> {
    await this.deps.backups.save(file.localPath).catch((error) => {
      throw Object.assign(new Error('Backup failed', { cause: error }), { code: 'BACKUP_FAILED' });
    });

    const { output } = await appendExpensesToBuffer(source, queue, this.deps.excelOptions);
    const resultPath = join(dirname(file.localPath), 'result.xlsx');
    await writeFile(resultPath, output);
    return resultPath;
  }

  private async handleUploadFailure(error: unknown, ids: string[]): Promise<void> {
    // Файл точно не менялся — возвращаем в очередь. Иначе результат неизвестен: оставляем
    // «writing», следующая сверка разберётся.
    if (error instanceof OneDriveError && error.wasRejected) {
      await this.deps.expenses.markPending(this.deps.database, ids, error.code);
    }
  }
}

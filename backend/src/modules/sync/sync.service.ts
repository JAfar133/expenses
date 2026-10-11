import { readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { BackupStore } from '../../infrastructure/backup/backup.service.ts';
import type { Database } from '../../infrastructure/database/database.ts';
import { appendExpensesToBuffer, readExcelExpenses } from '../../services/excel.service.ts';
import type { ExcelOptions } from '../../services/excel/types.ts';
import { OneDriveError } from '../../services/onedrive/errors.ts';
import type { DownloadedFile, OneDriveService } from '../../services/onedrive/types.ts';
import type { ExpenseRepository, StoredExpense } from '../../storage/expense.repository.ts';
import { isMassDeletion, reconcile } from './reconcile.ts';
import { describeSyncError } from './sync-errors.ts';
import type { SyncStateRepository } from './sync-state.repository.ts';
import type { SyncResult, SyncStatusView } from './sync.types.ts';

export interface SyncServiceDeps {
  database: Database;
  expenses: ExpenseRepository;
  /** Не задан: работа с Excel отключена, расходы остаются только в базе */
  oneDrive?: OneDriveService;
  backups: BackupStore;
  excelOptions: ExcelOptions;
  state: SyncStateRepository;
  /** Максимальная доля записей, которую можно пометить удалёнными за один цикл (по умолчанию 25%) */
  maxDeletePercent?: number;
  logger?: {
    info: (fields: object, message: string) => void;
    warn: (fields: object, message: string) => void;
  };
}

export interface CycleOptions {
  /** Применить удаления, даже если пропало подозрительно много записей (ручное подтверждение) */
  applyDeletions?: boolean;
}

const DEFAULT_MAX_DELETE_PERCENT = 25;

/** Сколько раз подряд повторяем цикл, если файл изменили прямо во время записи. */
const MAX_CONFLICT_ATTEMPTS = 2;

/**
 * Синхронизация PostgreSQL ↔ Excel. За один цикл:
 *   1. скачиваем свежий Excel;
 *   2. строки, которых нет в БД (добавлены в Excel вручную), добавляем в БД; записи, строк которых
 *      больше нет в Excel (удалены или изменены), помечаем удалёнными, но не стираем (мягкое удаление);
 *   3. записи из очереди (ещё не попавшие в Excel) дописываем в Excel и загружаем файл.
 *
 * Цикл всегда один за раз. Запросы, пришедшие во время работы цикла, объединяются в один
 * следующий цикл: он стартует после запроса, поэтому видит все записи, добавленные до него.
 */
export class SyncService {
  private running?: Promise<SyncResult>;
  private next?: Promise<SyncResult>;
  /** Параметры следующего цикла: запросы, которые к нему присоединились, объединяются */
  private nextOptions: CycleOptions = {};
  private lastResult?: SyncResult;

  constructor(private readonly deps: SyncServiceDeps) {}

  get isRunning(): boolean {
    return this.running !== undefined;
  }

  /** Работа с Excel включена, если задан файл в OneDrive. */
  get enabled(): boolean {
    return this.deps.oneDrive !== undefined;
  }

  /** Запускает цикл (или присоединяется к ожидающему). Не бросает ошибок: итог — в результате. */
  requestCycle(options: CycleOptions = {}): Promise<SyncResult> {
    if (!this.enabled) {
      return Promise.resolve(this.disabledResult());
    }
    if (!this.running) {
      return this.start(options);
    }

    // Следующий цикл один на всех: если кто-то из присоединившихся просит применить удаления, применяем
    this.nextOptions = {
      applyDeletions: this.nextOptions.applyDeletions || options.applyDeletions,
    };
    this.next ??= this.running.then(() => {
      const cycleOptions = this.nextOptions;
      this.nextOptions = {};
      this.next = undefined;
      return this.start(cycleOptions);
    });
    return this.next;
  }

  async status(): Promise<SyncStatusView> {
    if (!this.enabled) {
      // Записи остаются в очереди: если Excel подключат позже, они допишутся сами
      return { enabled: false, lastResult: this.disabledResult(), queued: 0, running: false };
    }
    this.lastResult ??= await this.deps.state.get();
    return {
      enabled: true,
      lastResult: this.lastResult,
      queued: await this.deps.expenses.countQueue(),
      running: this.isRunning,
    };
  }

  private disabledResult(): SyncResult {
    const now = new Date().toISOString();
    return {
      startedAt: now,
      finishedAt: now,
      status: 'disabled',
      imported: 0,
      written: 0,
      queued: 0,
      deleted: 0,
      restored: 0,
      deletionsBlocked: 0,
      skipped: 0,
      skippedRows: [],
    };
  }

  private start(options: CycleOptions): Promise<SyncResult> {
    const run = this.runWithConflictRetry(options).finally(() => {
      if (this.running === run) this.running = undefined;
    });
    this.running = run;
    return run;
  }

  private async runWithConflictRetry(options: CycleOptions): Promise<SyncResult> {
    let result = await this.runCycle(options);
    for (
      let attempt = 1;
      attempt < MAX_CONFLICT_ATTEMPTS && result.error?.code === 'VERSION_CONFLICT';
      attempt++
    ) {
      result = await this.runCycle(options);
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
        deleted: result.deleted,
        restored: result.restored,
        deletionsBlocked: result.deletionsBlocked,
        skipped: result.skipped,
        errorCode: result.error?.code,
      },
      'Sync finished',
    );
    return result;
  }

  private async runCycle(options: CycleOptions): Promise<SyncResult> {
    const result: SyncResult = {
      startedAt: new Date().toISOString(),
      finishedAt: '',
      status: 'ok',
      imported: 0,
      written: 0,
      queued: 0,
      deleted: 0,
      restored: 0,
      deletionsBlocked: 0,
      skipped: 0,
      skippedRows: [],
    };

    try {
      await this.syncOnce(result, options);
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

  private async syncOnce(result: SyncResult, options: CycleOptions): Promise<void> {
    const oneDrive = this.deps.oneDrive!;
    const file = await oneDrive.downloadFile();

    try {
      const source = await readFile(file.localPath);
      await this.importFromExcel(source, result, options);
      await this.writeQueueToExcel(oneDrive, file, source, result);
    } finally {
      await rm(dirname(file.localPath), { recursive: true, force: true });
    }
  }

  /** Шаг 2: сверка с Excel: импорт новых строк, мягкое удаление пропавших, восстановление вернувшихся. */
  private async importFromExcel(
    source: Buffer,
    result: SyncResult,
    options: CycleOptions,
  ): Promise<void> {
    const excel = await readExcelExpenses(source, this.deps.excelOptions);
    const { expenses } = this.deps;
    const maxPercent = this.deps.maxDeletePercent ?? DEFAULT_MAX_DELETE_PERCENT;

    const outcome = await this.deps.database.transaction(async (tx) => {
      const dbRows = await expenses.listForReconcile(tx);
      const plan = reconcile(excel.expenses, dbRows);

      // Защита: если пропало слишком много записей сразу, удаления не применяем
      const blocked =
        !options.applyDeletions &&
        isMassDeletion({
          toDelete: plan.toDelete.length,
          activeSynced: dbRows.filter((r) => r.excelStatus === 'synced' && r.deletedAt === null)
            .length,
          excelRows: excel.expenses.length,
          maxPercent,
        });
      const toDelete = blocked ? [] : plan.toDelete;

      await expenses.restoreDeleted(tx, plan.toRestore);
      await expenses.markDeleted(tx, toDelete, 'excel');
      await expenses.markSynced(tx, plan.promoteToSynced);
      await expenses.markPending(tx, plan.revertToPending);

      return {
        imported: await expenses.importFromExcel(tx, plan.toImport),
        deleted: toDelete.length,
        restored: plan.toRestore.length,
        deletionsBlocked: blocked ? plan.toDelete.length : 0,
      };
    });

    result.imported = outcome.imported;
    result.deleted = outcome.deleted;
    result.restored = outcome.restored;
    result.deletionsBlocked = outcome.deletionsBlocked;
    result.skipped = excel.skippedCount;
    result.skippedRows = excel.skipped;

    if (outcome.deletionsBlocked > 0) {
      result.warning = {
        code: 'MASS_DELETION_BLOCKED',
        message: `В Excel пропало ${outcome.deletionsBlocked} записей сразу: это похоже на ошибку (пустой или подменённый файл), поэтому в базе они не помечены удалёнными. Проверьте файл`,
      };
      this.deps.logger?.warn(
        { blocked: outcome.deletionsBlocked, maxPercent },
        'Mass deletion blocked',
      );
    }
  }

  /** Шаг 3: дописывание очереди в Excel. */
  private async writeQueueToExcel(
    oneDrive: OneDriveService,
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
      await oneDrive.uploadFile(resultPath, file.version);
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

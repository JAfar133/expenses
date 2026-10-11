import { readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { BackupStore } from '../../infrastructure/backup/backup.service.ts';
import type { Database } from '../../infrastructure/database/database.ts';
import { readExcelExpenses } from '../../services/excel.service.ts';
import { applyEditsToBuffer, type RowEdits } from '../../services/excel/edit.ts';
import type { ExcelOptions } from '../../services/excel/types.ts';
import { OneDriveError } from '../../services/onedrive/errors.ts';
import type { DownloadedFile, OneDriveService } from '../../services/onedrive/types.ts';
import type {
  Expense,
  ExpenseRepository,
  StoredExpense,
} from '../../storage/expense.repository.ts';
import { isMassDeletion, reconcile } from './reconcile.ts';
import { describeSyncError } from './sync-errors.ts';
import type { SyncStateRepository } from './sync-state.repository.ts';
import type { SyncResult, SyncStatusView } from './sync.types.ts';

export interface SyncServiceDeps {
  database: Database;
  expenses: ExpenseRepository;
  /** Unset: Excel is disabled, expenses stay in the database only */
  oneDrive?: OneDriveService;
  backups: BackupStore;
  excelOptions: ExcelOptions;
  state: SyncStateRepository;
  /** Maximum share of records that may be marked deleted in one cycle (25% by default) */
  maxDeletePercent?: number;
  logger?: {
    info: (fields: object, message: string) => void;
    warn: (fields: object, message: string) => void;
  };
}

export interface CycleOptions {
  /** Apply deletions even if a suspiciously large number of records vanished (manual confirmation) */
  applyDeletions?: boolean;
}

const DEFAULT_MAX_DELETE_PERCENT = 25;

/** A row for Excel: only the five table columns, without the record's internal fields. */
const toExcelRow = ({ date, card, category, name, amount }: Expense): Expense => ({
  date,
  card,
  category,
  name,
  amount,
});

/** How many times in a row we repeat the cycle if the file was changed right during the write. */
const MAX_CONFLICT_ATTEMPTS = 2;

/**
 * PostgreSQL ↔ Excel sync. One cycle:
 *   1. download a fresh Excel;
 *   2. rows missing from the DB (added to Excel manually) are added to the DB; records whose rows
 *      are no longer in Excel (deleted or changed) are marked deleted but not erased (soft delete);
 *   3. queued records (not yet in Excel) are appended to Excel and the file is uploaded.
 *
 * Only one cycle runs at a time. Requests that arrive while a cycle is running are merged into one
 * next cycle: it starts after the request, so it sees all records added before it.
 */
export class SyncService {
  private running?: Promise<SyncResult>;
  private next?: Promise<SyncResult>;
  /** Parameters of the next cycle: requests that joined it are merged */
  private nextOptions: CycleOptions = {};
  private lastResult?: SyncResult;

  constructor(private readonly deps: SyncServiceDeps) {}

  get isRunning(): boolean {
    return this.running !== undefined;
  }

  /** Excel is enabled if an OneDrive file is set. */
  get enabled(): boolean {
    return this.deps.oneDrive !== undefined;
  }

  /** Starts a cycle (or joins the pending one). Never throws: the outcome is in the result. */
  requestCycle(options: CycleOptions = {}): Promise<SyncResult> {
    if (!this.enabled) {
      return Promise.resolve(this.disabledResult());
    }
    if (!this.running) {
      return this.start(options);
    }

    // The next cycle is shared by everyone: if any of those who joined asks to apply deletions, we apply them
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
      // Records stay in the queue: if Excel is connected later, they will be appended on their own
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
      updated: 0,
      removed: 0,
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
        updated: result.updated,
        removed: result.removed,
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
      updated: 0,
      removed: 0,
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
      await this.writeChangesToExcel(oneDrive, file, source, result);
    } finally {
      await rm(dirname(file.localPath), { recursive: true, force: true });
    }
  }

  /** Step 2: reconciliation with Excel: import of new rows, soft delete of vanished ones, restoring of returned ones. */
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

      // Safeguard: if too many records vanished at once, we do not apply the deletions
      const blocked =
        !options.applyDeletions &&
        isMassDeletion({
          toDelete: plan.toDelete.length,
          activeSynced: dbRows.filter((r) => r.excelStatus === 'synced' && r.deletedAt === null)
            .length,
          excelRows: excel.expenses.length,
          maxPercent,
        });
      // Unreadable rows may be records whose values were damaged by hand: they are not "vanished" yet,
      // so no deletions are applied until the rows are fixed
      const unreadable = excel.skippedCount > 0 && plan.toDelete.length > 0;
      const toDelete = blocked || unreadable ? [] : plan.toDelete;

      await expenses.restoreDeleted(tx, plan.toRestore);
      await expenses.clearSnapshots(tx, plan.toClearSnapshot);
      await expenses.markDeleted(tx, toDelete, 'excel');
      await expenses.markSynced(tx, plan.promoteToSynced);
      await expenses.markPending(tx, plan.revertToPending);

      return {
        imported: await expenses.importFromExcel(tx, plan.toImport),
        deleted: toDelete.length,
        restored: plan.toRestore.length,
        deletionsBlocked: blocked && !unreadable ? plan.toDelete.length : 0,
        deletionsDeferred: unreadable ? plan.toDelete.length : 0,
      };
    });

    result.imported = outcome.imported;
    result.deleted = outcome.deleted;
    result.restored = outcome.restored;
    result.deletionsBlocked = outcome.deletionsBlocked;
    result.skipped = excel.skippedCount;
    result.skippedRows = excel.skipped;

    if (outcome.deletionsDeferred > 0) {
      result.warning = {
        code: 'UNREADABLE_ROWS',
        message: `В Excel есть строки, которые не удалось прочитать (${excel.skippedCount}), поэтому ${outcome.deletionsDeferred} записей не помечены удалёнными. Исправьте строки в файле — удаления применятся после этого`,
      };
      this.deps.logger?.warn(
        { deferred: outcome.deletionsDeferred, unreadable: excel.skippedCount },
        'Deletions deferred: unreadable rows in Excel',
      );
    } else if (outcome.deletionsBlocked > 0) {
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

  /**
   * Step 3: transfer to Excel everything accumulated in the app: new records are appended,
   * edited ones replace their row, deleted ones are removed. All in one file and one upload.
   */
  private async writeChangesToExcel(
    oneDrive: OneDriveService,
    file: DownloadedFile,
    source: Buffer,
    result: SyncResult,
  ): Promise<void> {
    const { expenses, database } = this.deps;
    const queue = await expenses.listQueue(database);
    const { updates, removals } = await expenses.listExcelChanges(database);
    if (queue.length + updates.length + removals.length === 0) return;

    const ids = queue.map((item) => item.id);
    const resultPath = await this.prepareFile(file, source, {
      appends: queue,
      updates: updates.map(({ from, to }) => ({ from, to })),
      removals: removals.map(({ snapshot }) => snapshot),
    });

    // We record "writing" before the upload: if the process crashes after it, the next reconciliation
    // will tell from the Excel contents whether the write went through, and will not create a duplicate.
    await expenses.markWriting(database, ids);

    try {
      await oneDrive.uploadFile(resultPath, file.version);
    } catch (error) {
      await this.handleUploadFailure(error, ids);
      throw error;
    }

    // The snapshot gets what was written to the file, not what the record holds now: if the record was
    // edited again in the meantime, the next sync will replace the row once more.
    await expenses.markSyncedAs(
      database,
      queue.map((item) => ({ id: item.id, snapshot: toExcelRow(item) })),
    );
    await expenses.setSnapshots(
      database,
      updates.map(({ id, to }) => ({ id, snapshot: to })),
    );
    await expenses.clearSnapshots(
      database,
      removals.map(({ id }) => id),
    );
    result.written = ids.length;
    result.updated = updates.length;
    result.removed = removals.length;
  }

  /** Backup and a new file with all changes applied. The DB is not changed before the upload. */
  private async prepareFile(
    file: DownloadedFile,
    source: Buffer,
    edits: { appends: StoredExpense[]; updates: RowEdits['updates']; removals: Expense[] },
  ): Promise<string> {
    await this.deps.backups.save(file.localPath).catch((error) => {
      throw Object.assign(new Error('Backup failed', { cause: error }), { code: 'BACKUP_FAILED' });
    });

    const output = await applyEditsToBuffer(
      source,
      {
        appends: edits.appends.map(toExcelRow),
        updates: edits.updates,
        removals: edits.removals,
      },
      this.deps.excelOptions,
    );
    const resultPath = join(dirname(file.localPath), 'result.xlsx');
    await writeFile(resultPath, output);
    return resultPath;
  }

  private async handleUploadFailure(error: unknown, ids: string[]): Promise<void> {
    // The file was definitely not changed — return to the queue. Otherwise the outcome is unknown: leave
    // "writing", the next reconciliation will sort it out.
    if (error instanceof OneDriveError && error.wasRejected) {
      await this.deps.expenses.markPending(this.deps.database, ids, error.code);
    }
  }
}

import type { SkippedRow } from '../../services/excel/read.ts';

/**
 * ok          — Excel was read and the queue was written
 * locked      — the file is open in Excel: reading worked, writing is postponed
 * unavailable — OneDrive is unavailable (network, authorization, no file)
 * error       — another error (corrupted file, backup failure, etc.)
 * disabled    — Excel is disabled (ONEDRIVE_FILE_PATH is not set)
 */
export type SyncStatus = 'ok' | 'locked' | 'unavailable' | 'error' | 'disabled';

export interface SyncResult {
  startedAt: string;
  finishedAt: string;
  status: SyncStatus;
  /** New Excel rows added to the DB */
  imported: number;
  /** Records from the queue appended to Excel */
  written: number;
  /** Records edited in the app whose rows were replaced in Excel */
  updated: number;
  /** Records deleted in the app whose rows were removed from Excel */
  removed: number;
  /** How many records are still waiting to be written to Excel */
  queued: number;
  /** DB records marked deleted: their row was deleted or changed in Excel (soft delete) */
  deleted: number;
  /** Previously deleted records whose rows reappeared in Excel */
  restored: number;
  /** How many deletions were not applied: too many records vanished at once, which looks like an error */
  deletionsBlocked: number;
  /** Excel rows that cannot be imported */
  skipped: number;
  skippedRows: SkippedRow[];
  error?: { code: string; message: string };
  /** Warning: the cycle completed but needs the user's attention (e.g. a mass deletion was blocked) */
  warning?: { code: string; message: string };
}

export interface SyncStatusView {
  /** Whether Excel is enabled */
  enabled: boolean;
  lastResult?: SyncResult;
  queued: number;
  running: boolean;
}

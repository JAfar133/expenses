import { apiRequest } from '../../../shared/api/http.ts';

export type SyncStatus = 'ok' | 'locked' | 'unavailable' | 'error' | 'disabled';

export interface SyncResult {
  startedAt: string;
  finishedAt: string;
  status: SyncStatus;
  /** New Excel rows added to the database */
  imported: number;
  /** Queued records appended to Excel */
  written: number;
  queued: number;
  /** Database records marked deleted: their row was deleted or changed in Excel (soft delete) */
  deleted: number;
  /** Previously deleted records whose rows reappeared in Excel */
  restored: number;
  /** How many deletions were not applied: too many records disappeared at once */
  deletionsBlocked: number;
  /** Excel rows that cannot be imported */
  skipped: number;
  error?: { code: string; message: string };
  /** Needs the user's attention although sync succeeded (e.g. mass deletion was blocked) */
  warning?: { code: string; message: string };
}

export interface SyncState {
  /** false: Excel is disabled on the server, the sync indicator is not needed */
  enabled: boolean;
  lastResult?: SyncResult;
  /** How many records are waiting to be written to Excel */
  queued: number;
  running: boolean;
  intervalMs: number;
  /** When the next sync starts; null while one is running */
  nextRunAt: string | null;
  /** Server time: the timer is computed from it, not relying on the device clock */
  serverTime: string;
}

export const fetchSyncState = async () => (await apiRequest<SyncState>('/sync/status')).data;

export const runSync = async () => (await apiRequest<SyncState>('/sync', { method: 'POST' })).data;

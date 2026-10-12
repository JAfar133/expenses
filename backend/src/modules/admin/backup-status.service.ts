import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export type BackupState = 'ok' | 'stale' | 'failed' | 'unknown';

export interface BackupSuccess {
  at: string;
  file: string;
  sizeBytes: number;
  /** The copy in OneDrive: ok, failed or off (not configured) */
  remote: 'ok' | 'failed' | 'off';
}

export interface BackupRun {
  at: string;
  ok: boolean;
  /** dump_failed, verify_failed, upload_failed, unexpected; empty if the run was good */
  error: string;
}

export interface BackupStatusView {
  /** The status folder is set up on the server */
  configured: boolean;
  state: BackupState;
  lastSuccess: BackupSuccess | null;
  lastRun: BackupRun | null;
  /** How old the last good copy is, in hours; null if there is none */
  ageHours: number | null;
  maxAgeHours: number;
}

export interface BackupStatusOptions {
  /** Folder with `backup-last-run.json` and `backup-last-success.json` written by scripts/backup-db.sh */
  dir: string;
  maxAgeHours: number;
  now?: () => number;
}

const HOUR_MS = 3_600_000;

/**
 * What the database backup script reported: the last run and the last good copy. The app only reads the files
 * (the folder is mounted read-only); it never touches the backups themselves.
 */
export class BackupStatusService {
  constructor(private readonly options: BackupStatusOptions) {}

  async view(): Promise<BackupStatusView> {
    const { dir, maxAgeHours } = this.options;
    if (!dir) {
      return {
        configured: false,
        state: 'unknown',
        lastSuccess: null,
        lastRun: null,
        ageHours: null,
        maxAgeHours,
      };
    }

    const lastRun = await readJson<BackupRun>(join(dir, 'backup-last-run.json'), isRun);
    const lastSuccess = await readJson<BackupSuccess>(
      join(dir, 'backup-last-success.json'),
      isSuccess,
    );
    const now = (this.options.now ?? Date.now)();
    const ageHours = lastSuccess ? Math.max(0, (now - Date.parse(lastSuccess.at)) / HOUR_MS) : null;

    let state: BackupState = 'ok';
    if (!lastRun && !lastSuccess) state = 'unknown';
    else if (lastRun && !lastRun.ok) state = 'failed';
    else if (ageHours === null || ageHours > maxAgeHours) state = 'stale';

    return { configured: true, state, lastSuccess, lastRun, ageHours, maxAgeHours };
  }
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isRun = (value: unknown): value is BackupRun =>
  isObject(value) &&
  typeof value.at === 'string' &&
  typeof value.ok === 'boolean' &&
  typeof value.error === 'string';

const isSuccess = (value: unknown): value is BackupSuccess =>
  isObject(value) &&
  typeof value.at === 'string' &&
  typeof value.file === 'string' &&
  typeof value.sizeBytes === 'number' &&
  (value.remote === 'ok' || value.remote === 'failed' || value.remote === 'off');

/** A missing or broken file is "no information", never an error of the app. */
async function readJson<T>(path: string, guard: (value: unknown) => value is T): Promise<T | null> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path, 'utf8'));
    return guard(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

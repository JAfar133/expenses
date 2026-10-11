import { randomBytes } from 'node:crypto';
import { chmod, constants, copyFile, mkdir, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';

export interface BackupServiceOptions {
  dir: string;
  retentionDays: number;
  /** Time zone for folder and file names, e.g. Asia/Yerevan */
  timezone: string;
  now?: () => Date;
}

export interface BackupStore {
  save(sourcePath: string): Promise<string>;
}

const DAY_MS = 86_400_000;
const DATE_DIR = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Excel backups before every change:
 *   <dir>/2026-10-10/expenses-20-15-32-a1b2c3.xlsx
 * The copies contain financial data, so they are accessible only to the owner (0700/0600).
 */
export class BackupService implements BackupStore {
  private readonly now: () => Date;

  constructor(private readonly options: BackupServiceOptions) {
    this.now = options.now ?? (() => new Date());
  }

  /** Copies a file to the backup directory and returns the copy path. Existing copies are not overwritten. */
  async save(sourcePath: string): Promise<string> {
    const { date, time } = this.formatLocal(this.now());
    const directory = join(this.options.dir, date);
    await mkdir(directory, { recursive: true, mode: 0o700 });

    const target = join(directory, `expenses-${time}-${randomBytes(3).toString('hex')}.xlsx`);
    await copyFile(sourcePath, target, constants.COPYFILE_EXCL);
    await chmod(target, 0o600);
    return target;
  }

  /** Removes date folders older than the retention period. Returns the number of removed folders. */
  async cleanup(): Promise<number> {
    const cutoff = this.formatLocal(
      new Date(this.now().getTime() - this.options.retentionDays * DAY_MS),
    ).date;

    let entries: string[];
    try {
      entries = await readdir(this.options.dir);
    } catch {
      return 0; // No copies yet
    }

    // YYYY-MM-DD dates compare as strings; we leave foreign folders and files alone
    const expired = entries.filter((name) => DATE_DIR.test(name) && name < cutoff);
    await Promise.all(
      expired.map((name) => rm(join(this.options.dir, name), { recursive: true, force: true })),
    );
    return expired.length;
  }

  private formatLocal(moment: Date): { date: string; time: string } {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: this.options.timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(moment);

    const get = (type: string) => parts.find((part) => part.type === type)!.value;
    return {
      date: `${get('year')}-${get('month')}-${get('day')}`,
      time: `${get('hour')}-${get('minute')}-${get('second')}`,
    };
  }
}

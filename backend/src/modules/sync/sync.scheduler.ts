import type { CycleOptions, SyncService } from './sync.service.ts';
import type { SyncResult } from './sync.types.ts';

export interface SyncSchedulerOptions {
  sync: Pick<SyncService, 'requestCycle'>;
  /** Regular interval between syncs */
  intervalMs: number;
  /** Interval while the queue holds records that could not be written to Excel */
  retryMs: number;
  now?: () => number;
}

/**
 * Runs the sync on a timer. After each run (by timer or manual)
 * the timer starts over, so the user sees a single clear countdown.
 */
export class SyncScheduler {
  private timer?: NodeJS.Timeout;
  private nextRunAt?: number;
  private stopped = true;
  private readonly now: () => number;

  constructor(private readonly options: SyncSchedulerOptions) {
    this.now = options.now ?? Date.now;
  }

  /** Starts the schedule. By default the first sync runs immediately. */
  start({ runNow = true }: { runNow?: boolean } = {}): void {
    this.stopped = false;
    this.scheduleIn(runNow ? 0 : this.options.intervalMs);
  }

  stop(): void {
    this.stopped = true;
    clearTimeout(this.timer);
    this.nextRunAt = undefined;
  }

  /** Time of the next run; undefined while a sync is running or the schedule is stopped. */
  get nextRun(): Date | undefined {
    return this.nextRunAt === undefined ? undefined : new Date(this.nextRunAt);
  }

  get intervalMs(): number {
    return this.options.intervalMs;
  }

  /** Manual run (a button in the UI). */
  syncNow(options: CycleOptions = {}): Promise<SyncResult> {
    return this.run(options);
  }

  private scheduleIn(delayMs: number): void {
    clearTimeout(this.timer);
    this.nextRunAt = this.now() + delayMs;
    this.timer = setTimeout(() => void this.run(), delayMs);
    this.timer.unref();
  }

  private async run(options: CycleOptions = {}): Promise<SyncResult> {
    clearTimeout(this.timer);
    this.nextRunAt = undefined;

    const result = await this.options.sync.requestCycle(options);

    if (!this.stopped) {
      this.scheduleIn(this.delayAfter(result));
    }
    return result;
  }

  /** If records are stuck in the queue (the file is open in Excel), we try more often than usual. */
  private delayAfter(result: SyncResult): number {
    const stuck = result.queued > 0 && result.status !== 'ok';
    return stuck ? this.options.retryMs : this.options.intervalMs;
  }
}

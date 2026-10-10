import type { SyncService } from './sync.service.ts';
import type { SyncResult } from './sync.types.ts';

export interface SyncSchedulerOptions {
  sync: Pick<SyncService, 'requestCycle'>;
  /** Обычный интервал между синхронизациями */
  intervalMs: number;
  /** Интервал, пока в очереди есть записи, которые не удалось записать в Excel */
  retryMs: number;
  now?: () => number;
}

/**
 * Запускает синхронизацию по таймеру. После каждого запуска (по таймеру или вручную)
 * таймер начинается заново, поэтому пользователь видит один понятный обратный отсчёт.
 */
export class SyncScheduler {
  private timer?: NodeJS.Timeout;
  private nextRunAt?: number;
  private stopped = true;
  private readonly now: () => number;

  constructor(private readonly options: SyncSchedulerOptions) {
    this.now = options.now ?? Date.now;
  }

  /** Запускает расписание. По умолчанию первая синхронизация выполняется сразу. */
  start({ runNow = true }: { runNow?: boolean } = {}): void {
    this.stopped = false;
    this.scheduleIn(runNow ? 0 : this.options.intervalMs);
  }

  stop(): void {
    this.stopped = true;
    clearTimeout(this.timer);
    this.nextRunAt = undefined;
  }

  /** Время следующего запуска; undefined, пока синхронизация выполняется или расписание остановлено. */
  get nextRun(): Date | undefined {
    return this.nextRunAt === undefined ? undefined : new Date(this.nextRunAt);
  }

  get intervalMs(): number {
    return this.options.intervalMs;
  }

  /** Ручной запуск (кнопка в интерфейсе). */
  syncNow(): Promise<SyncResult> {
    return this.run();
  }

  private scheduleIn(delayMs: number): void {
    clearTimeout(this.timer);
    this.nextRunAt = this.now() + delayMs;
    this.timer = setTimeout(() => void this.run(), delayMs);
    this.timer.unref();
  }

  private async run(): Promise<SyncResult> {
    clearTimeout(this.timer);
    this.nextRunAt = undefined;

    const result = await this.options.sync.requestCycle();

    if (!this.stopped) {
      this.scheduleIn(this.delayAfter(result));
    }
    return result;
  }

  /** Если записи застряли в очереди (файл открыт в Excel), пробуем чаще обычного. */
  private delayAfter(result: SyncResult): number {
    const stuck = result.queued > 0 && result.status !== 'ok';
    return stuck ? this.options.retryMs : this.options.intervalMs;
  }
}

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SyncScheduler } from '../../src/modules/sync/sync.scheduler.ts';
import type { SyncResult } from '../../src/modules/sync/sync.types.ts';
import { okResult } from '../helpers/create-test-app.ts';

const MINUTE = 60_000;

let results: SyncResult[];
let cycles: number;

const sync = {
  requestCycle: async () => {
    cycles++;
    return results.shift() ?? okResult();
  },
};

const createScheduler = () => new SyncScheduler({ sync, intervalMs: 5 * MINUTE, retryMs: MINUTE });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-10T10:00:00Z'));
  results = [];
  cycles = 0;
});

afterEach(() => vi.useRealTimers());

describe('расписание', () => {
  it('первая синхронизация стартует сразу, следующая — через интервал', async () => {
    const scheduler = createScheduler();

    scheduler.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(cycles).toBe(1);

    expect(scheduler.nextRun).toEqual(new Date('2026-10-10T10:05:00Z'));
    await vi.advanceTimersByTimeAsync(5 * MINUTE);
    expect(cycles).toBe(2);
    scheduler.stop();
  });

  it('start({ runNow: false }) ждёт полный интервал', async () => {
    const scheduler = createScheduler();

    scheduler.start({ runNow: false });
    await vi.advanceTimersByTimeAsync(4 * MINUTE);
    expect(cycles).toBe(0);

    await vi.advanceTimersByTimeAsync(MINUTE);
    expect(cycles).toBe(1);
    scheduler.stop();
  });

  it('ручной запуск выполняет синхронизацию и сдвигает таймер заново', async () => {
    const scheduler = createScheduler();
    scheduler.start({ runNow: false });
    await vi.advanceTimersByTimeAsync(3 * MINUTE);

    await scheduler.syncNow();

    expect(cycles).toBe(1);
    expect(scheduler.nextRun).toEqual(new Date('2026-10-10T10:08:00Z'));
    await vi.advanceTimersByTimeAsync(4 * MINUTE);
    expect(cycles).toBe(1);
    await vi.advanceTimersByTimeAsync(MINUTE);
    expect(cycles).toBe(2);
    scheduler.stop();
  });

  it('пока синхронизация идёт, времени следующего запуска нет', async () => {
    let finish!: () => void;
    const slow = new SyncScheduler({
      sync: { requestCycle: () => new Promise((resolve) => (finish = () => resolve(okResult()))) },
      intervalMs: 5 * MINUTE,
      retryMs: MINUTE,
    });

    slow.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(slow.nextRun).toBeUndefined();

    finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(slow.nextRun).toEqual(new Date('2026-10-10T10:05:00Z'));
    slow.stop();
  });
});

describe('повторы при застрявшей очереди', () => {
  it('если записи не удалось отправить в Excel, повтор через минуту, а не через пять', async () => {
    results = [okResult({ status: 'locked', queued: 2 })];
    const scheduler = createScheduler();

    scheduler.start();
    await vi.advanceTimersByTimeAsync(0);

    expect(scheduler.nextRun).toEqual(new Date('2026-10-10T10:01:00Z'));
    scheduler.stop();
  });

  it('когда очередь пуста, возвращается обычный интервал', async () => {
    results = [okResult({ status: 'locked', queued: 1 }), okResult({ status: 'ok', queued: 0 })];
    const scheduler = createScheduler();

    scheduler.start();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(MINUTE);

    expect(scheduler.nextRun).toEqual(new Date('2026-10-10T10:06:00Z'));
    scheduler.stop();
  });

  it('успешная синхронизация с непустой очередью (новые записи) не ускоряет повторы', async () => {
    results = [okResult({ status: 'ok', queued: 1 })];
    const scheduler = createScheduler();

    scheduler.start();
    await vi.advanceTimersByTimeAsync(0);

    expect(scheduler.nextRun).toEqual(new Date('2026-10-10T10:05:00Z'));
    scheduler.stop();
  });
});

describe('остановка', () => {
  it('после stop() синхронизации больше не запускаются', async () => {
    const scheduler = createScheduler();
    scheduler.start();
    await vi.advanceTimersByTimeAsync(0);

    scheduler.stop();
    await vi.advanceTimersByTimeAsync(10 * MINUTE);

    expect(cycles).toBe(1);
    expect(scheduler.nextRun).toBeUndefined();
  });
});

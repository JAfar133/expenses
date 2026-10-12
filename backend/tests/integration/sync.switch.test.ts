import { readFile } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { BackupStore } from '../../src/infrastructure/backup/backup.service.ts';
import type { Database } from '../../src/infrastructure/database/database.ts';
import { SyncScheduler } from '../../src/modules/sync/sync.scheduler.ts';
import { SyncService } from '../../src/modules/sync/sync.service.ts';
import { SyncStateRepository } from '../../src/modules/sync/sync-state.repository.ts';
import { SyncSwitch } from '../../src/modules/sync/sync-switch.ts';
import type { Expense } from '../../src/storage/expense.repository.ts';
import { PostgresExpenseRepository } from '../../src/storage/postgres/postgres.repository.ts';
import { createTestApp, type TestApp } from '../helpers/create-test-app.ts';
import { FakeOneDrive } from '../helpers/fake-onedrive.ts';
import { createTestDatabase } from '../helpers/test-database.ts';

const options = { sheetName: 'Лист1', tableName: 'Операции' };
const FIXTURE = new URL('../fixtures/expenses-dev.xlsx', import.meta.url).pathname;
const coffee: Expense = {
  date: '2026-10-11',
  card: 'Миша',
  category: 'кафе',
  name: 'Кофе',
  amount: 640,
};

let database: Database;
let expenses: PostgresExpenseRepository;
let oneDrive: FakeOneDrive;
let sync: SyncService;
let scheduler: SyncScheduler;
let syncSwitch: SyncSwitch;

const backups = { save: async () => '/backups/x.xlsx' } as unknown as BackupStore;

const build = async (configured = true) => {
  database = await createTestDatabase();
  expenses = new PostgresExpenseRepository(database);
  oneDrive = new FakeOneDrive(await readFile(FIXTURE));
  sync = new SyncService({
    database,
    expenses,
    oneDrive: configured ? oneDrive : undefined,
    backups,
    excelOptions: options,
    state: new SyncStateRepository(database),
  });
  scheduler = new SyncScheduler({ sync, intervalMs: 3_600_000, retryMs: 3_600_000 });
  syncSwitch = new SyncSwitch(database, sync, scheduler);
};

afterEach(async () => {
  scheduler.stop();
  await database.close();
});

describe('выключатель синхронизации', () => {
  beforeEach(() => build());

  it('без сохранённого выбора следует настройке сервера: файл задан — включена', async () => {
    expect(await syncSwitch.view()).toEqual({ configured: true, enabled: true });
  });

  it('выключенная: OneDrive не трогается совсем, ни скачивания, ни записи', async () => {
    await syncSwitch.set(false);
    await expenses.insertPending(database, coffee, 'misha');

    const result = await sync.requestCycle();

    expect(result.status).toBe('disabled');
    expect(oneDrive.downloads).toBe(0);
    expect(oneDrive.uploads).toBe(0);
    expect(sync.enabled).toBe(false);
    expect(await sync.status()).toMatchObject({ enabled: false, queued: 0 });
  });

  it('выбор хранится в базе и переживает перезапуск', async () => {
    await syncSwitch.set(false);

    const afterRestart = new SyncSwitch(database, sync, scheduler);
    expect(await afterRestart.load()).toEqual({ configured: true, enabled: false });
    expect(sync.enabled).toBe(false);
  });

  it('включение запускает цикл: записи, сделанные за время паузы, попадают в Excel', async () => {
    await syncSwitch.set(false);
    await expenses.insertPending(database, coffee, 'misha');
    expect(oneDrive.uploads).toBe(0);

    await syncSwitch.set(true);
    await sync.requestCycle();

    expect(sync.enabled).toBe(true);
    expect(oneDrive.uploads).toBe(1);
    expect(await expenses.countQueue()).toBe(0);
  });

  it('выключение останавливает таймер', async () => {
    await syncSwitch.load();
    expect(scheduler.nextRun).toBeDefined();

    await syncSwitch.set(false);

    expect(scheduler.nextRun).toBeUndefined();
  });
});

describe('Excel не настроен на сервере', () => {
  beforeEach(() => build(false));

  it('показывается как ненастроенный; включить нельзя', async () => {
    expect(await syncSwitch.view()).toEqual({ configured: false, enabled: false });
    await expect(syncSwitch.set(true)).rejects.toMatchObject({
      statusCode: 409,
      code: 'EXCEL_NOT_CONFIGURED',
    });
  });
});

describe('API выключателя', () => {
  let t: TestApp;
  const call = (method: 'GET' | 'PUT', as: string, payload?: unknown) =>
    t.inject(
      {
        method,
        url: '/api/admin/sync',
        ...(payload === undefined ? {} : { payload: payload as object }),
      },
      as,
    );

  beforeEach(async () => {
    await build();
    t = await createTestApp(database);
  });

  it('только администратор приложения', async () => {
    expect((await call('GET', 'nastya')).statusCode).toBe(403);
    expect((await call('PUT', 'nastya', { enabled: false })).statusCode).toBe(403);
  });

  it('администратор видит состояние и меняет его', async () => {
    expect((await call('GET', 'misha')).json().data).toEqual({ configured: true, enabled: true });

    const off = await call('PUT', 'misha', { enabled: false });

    expect(off.json().data).toEqual({ configured: true, enabled: false });
    expect(
      (await t.inject({ method: 'GET', url: '/api/sync/status' }, 'misha')).json().data.enabled,
    ).toBe(false);
  });

  it('неверное тело отклоняется', async () => {
    expect((await call('PUT', 'misha', { enabled: 'yes' })).statusCode).toBe(422);
  });
});

import { readFile } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { BackupStore } from '../../src/infrastructure/backup/backup.service.ts';
import type { Database } from '../../src/infrastructure/database/database.ts';
import { SyncService } from '../../src/modules/sync/sync.service.ts';
import { SyncStateRepository } from '../../src/modules/sync/sync-state.repository.ts';
import { appendExpenseToBuffer, readExcelExpenses } from '../../src/services/excel.service.ts';
import { OneDriveError } from '../../src/services/onedrive/errors.ts';
import type { Expense, StoredExpense } from '../../src/storage/expense.repository.ts';
import { PostgresExpenseRepository } from '../../src/storage/postgres/postgres.repository.ts';
import { FakeOneDrive } from '../helpers/fake-onedrive.ts';
import { createTestDatabase } from '../helpers/test-database.ts';

const excelOptions = { sheetName: 'Лист1', tableName: 'Операции' };
const FIXTURE = new URL('../fixtures/expenses-dev.xlsx', import.meta.url).pathname;

const coffee: Expense = {
  date: '2026-10-11',
  card: 'Миша',
  category: 'кафе',
  name: 'Кофе',
  amount: 640,
};
const bread: Expense = {
  ...coffee,
  card: 'Настя',
  category: 'продукты',
  name: 'Хлеб',
  amount: 300,
};

let database: Database;
let expenses: PostgresExpenseRepository;
let oneDrive: FakeOneDrive;
let sync: SyncService;
let backups: BackupStore & { saved: number };
let baseline: Expense[];

const excel = async () => (await readExcelExpenses(oneDrive.remote, excelOptions)).expenses;
const same = (a: Expense, b: Expense) => JSON.stringify(a) === JSON.stringify(b);
const count = async (expense: Expense) => (await excel()).filter((e) => same(e, expense)).length;
const values = ({ date, card, category, name, amount }: StoredExpense): Expense => ({
  date,
  card,
  category,
  name,
  amount,
});

/** An app record that is already in Excel. */
async function syncedRecord(expense: Expense = coffee): Promise<StoredExpense> {
  const created = await expenses.insertPending(database, expense, 'misha');
  await sync.requestCycle();
  return (await expenses.findById(created.id))!;
}

const reload = async (id: string) => (await expenses.findById(id))!;

beforeEach(async () => {
  database = await createTestDatabase();
  expenses = new PostgresExpenseRepository(database);
  oneDrive = new FakeOneDrive(await readFile(FIXTURE));
  backups = {
    saved: 0,
    async save() {
      this.saved++;
      return '/backups/x.xlsx';
    },
  } as BackupStore & { saved: number };
  sync = new SyncService({
    database,
    expenses,
    oneDrive,
    backups,
    excelOptions,
    state: new SyncStateRepository(database),
  });
  await sync.requestCycle(); // import of Excel rows
  baseline = await excel();
});

afterEach(() => database.close());

describe('правка записи, уже находящейся в Excel', () => {
  it('строка в Excel заменяется, новых записей не появляется, снимок обновляется', async () => {
    const record = await syncedRecord();
    const changed = { ...coffee, name: 'Кофе с молоком', amount: 800 };

    await expenses.updateValues(database, record.id, changed, 'misha', false);
    const result = await sync.requestCycle();

    expect(result).toMatchObject({ status: 'ok', updated: 1, removed: 0, written: 0, imported: 0 });
    expect(await count(changed)).toBe(1);
    expect(await count(coffee)).toBe(0);
    expect((await excel()).length).toBe(baseline.length + 1);
    const after = await reload(record.id);
    expect(after).toMatchObject({ ...changed, excelSnapshot: changed, excelStatus: 'synced' });
    // The same record: no duplicate and no deleted copy
    expect(
      (await expenses.listForReconcile(database)).filter((r) => r.name.startsWith('Кофе')),
    ).toHaveLength(1);
  });

  it('повторная синхронизация ничего не меняет и не загружает файл', async () => {
    const record = await syncedRecord();
    await expenses.updateValues(database, record.id, { ...coffee, amount: 1 }, 'misha', false);
    await sync.requestCycle();
    const uploads = oneDrive.uploads;

    const again = await sync.requestCycle();

    expect(again).toMatchObject({ updated: 0, removed: 0, written: 0, imported: 0, deleted: 0 });
    expect(oneDrive.uploads).toBe(uploads);
  });

  it('перед записью делается резервная копия', async () => {
    const record = await syncedRecord();
    const before = backups.saved;

    await expenses.updateValues(database, record.id, { ...coffee, amount: 5 }, 'misha', false);
    await sync.requestCycle();

    expect(backups.saved).toBe(before + 1);
  });

  it('пока файл занят, правка ждёт в очереди: в Excel прежняя строка, дубля нет; потом применяется', async () => {
    const record = await syncedRecord();
    const changed = { ...coffee, amount: 999 };
    await expenses.updateValues(database, record.id, changed, 'misha', false);
    oneDrive.locked = true;

    const blocked = await sync.requestCycle();

    expect(blocked.status).toBe('locked');
    expect(await count(coffee)).toBe(1);
    expect((await reload(record.id)).excelSnapshot).toEqual(coffee);
    // Reconciliation while the file is busy does not treat the old row as missing or create a duplicate
    expect(
      (await expenses.listForReconcile(database)).filter((r) => r.name === 'Кофе'),
    ).toHaveLength(1);

    oneDrive.locked = false;
    await sync.requestCycle();

    expect(await count(changed)).toBe(1);
    expect(await count(coffee)).toBe(0);
  });

  it('правка нескольких записей и несколько правок одной записи за один проход', async () => {
    const [a, b] = [await syncedRecord(coffee), await syncedRecord(bread)];

    await expenses.updateValues(database, a.id, { ...coffee, amount: 1 }, 'misha', false);
    await expenses.updateValues(database, a.id, { ...coffee, amount: 2 }, 'misha', false);
    await expenses.updateValues(database, b.id, { ...bread, name: 'Батон' }, 'misha', false);
    const result = await sync.requestCycle();

    expect(result.updated).toBe(2);
    expect(await count({ ...coffee, amount: 2 })).toBe(1);
    expect(await count({ ...coffee, amount: 1 })).toBe(0);
    expect(await count({ ...bread, name: 'Батон' })).toBe(1);
  });

  it('запись правили снова, пока файл загружался: следующий проход применяет и вторую правку', async () => {
    const record = await syncedRecord();
    await expenses.updateValues(database, record.id, { ...coffee, amount: 1 }, 'misha', false);
    // The second edit arrives after the change set is built but before the upload finishes
    let release!: () => void;
    oneDrive.uploadGate = new Promise<void>((resolve) => (release = resolve));
    oneDrive.onUploadStart = () => {
      oneDrive.onUploadStart = undefined;
      void expenses
        .updateValues(database, record.id, { ...coffee, amount: 2 }, 'misha', false)
        .then(release);
    };

    const first = await sync.requestCycle();
    // The first edit made it into the file, and exactly it is recorded in the snapshot
    expect(first.updated).toBe(1);
    expect((await reload(record.id)).excelSnapshot).toEqual({ ...coffee, amount: 1 });
    oneDrive.uploadGate = undefined;
    const second = await sync.requestCycle();

    expect(second.updated).toBe(1);
    expect(await count({ ...coffee, amount: 2 })).toBe(1);
    expect(await count({ ...coffee, amount: 1 })).toBe(0);
  });

  it('запись, которой ещё нет в Excel (в очереди), просто допишется с новыми значениями', async () => {
    oneDrive.locked = true;
    const created = await expenses.insertPending(database, coffee, 'misha');
    await sync.requestCycle();
    const changed = { ...coffee, name: 'Исправлено' };

    await expenses.updateValues(database, created.id, changed, 'misha', false);
    oneDrive.locked = false;
    const result = await sync.requestCycle();

    expect(result.written).toBe(1);
    expect(await count(changed)).toBe(1);
    expect(await count(coffee)).toBe(0);
  });

  it('строку изменили в Excel вручную: запись помечается удалённой из-за Excel, дубля нет', async () => {
    const record = await syncedRecord();
    await expenses.updateValues(database, record.id, { ...coffee, amount: 5 }, 'misha', false);
    // Someone edited the row directly in Excel
    oneDrive.remote = await (
      await import('../../src/services/excel/edit.ts')
    ).applyEditsToBuffer(
      oneDrive.remote,
      { updates: [{ from: coffee, to: { ...coffee, amount: 777 } }], removals: [], appends: [] },
      excelOptions,
    );

    const result = await sync.requestCycle();

    expect(result).toMatchObject({ status: 'ok', deleted: 1, imported: 1, updated: 0 });
    expect(await count({ ...coffee, amount: 777 })).toBe(1);
    expect(await count({ ...coffee, amount: 5 })).toBe(0);
  });
});

describe('удаление записи в приложении', () => {
  it('строка убирается из Excel, запись остаётся в базе удалённой, снимок сбрасывается', async () => {
    const record = await syncedRecord();

    await expenses.markDeletedByApp(database, record.id, 'misha');
    const result = await sync.requestCycle();

    expect(result).toMatchObject({ status: 'ok', removed: 1, imported: 0, deleted: 0 });
    expect(await count(coffee)).toBe(0);
    expect(await excel()).toEqual(baseline);
    const after = await reload(record.id);
    expect(after.deletedAt).not.toBeNull();
    expect(after).toMatchObject({ deletedReason: 'app', excelSnapshot: null });
  });

  it('строка вернётся в Excel? нет: удалённую запись повторная синхронизация не воскрешает', async () => {
    const record = await syncedRecord();
    await expenses.markDeletedByApp(database, record.id, 'misha');
    await sync.requestCycle();

    const again = await sync.requestCycle();

    expect(again).toMatchObject({ restored: 0, imported: 0, removed: 0 });
    expect((await reload(record.id)).deletedAt).not.toBeNull();
  });

  it('пока файл занят, удаление ждёт; строка в Excel не импортируется заново и запись не возвращается', async () => {
    const record = await syncedRecord();
    await expenses.markDeletedByApp(database, record.id, 'misha');
    oneDrive.locked = true;

    const blocked = await sync.requestCycle();

    expect(blocked.status).toBe('locked');
    expect(await count(coffee)).toBe(1);
    expect((await reload(record.id)).deletedAt).not.toBeNull();
    expect(blocked.imported).toBe(0);

    oneDrive.locked = false;
    await sync.requestCycle();

    expect(await count(coffee)).toBe(0);
  });

  it('удаляется только одна из одинаковых записей', async () => {
    const [first] = [await syncedRecord(), await syncedRecord()];
    expect(await count(coffee)).toBe(2);

    await expenses.markDeletedByApp(database, first.id, 'misha');
    await sync.requestCycle();

    expect(await count(coffee)).toBe(1);
    const active = (await expenses.listForReconcile(database)).filter(
      (r) => r.name === 'Кофе' && r.deletedAt === null,
    );
    expect(active).toHaveLength(1);
  });

  it('запись из очереди, которой не было в Excel, удаляется без обращения к Excel и не допишется', async () => {
    oneDrive.locked = true;
    const created = await expenses.insertPending(database, coffee, 'misha');
    await sync.requestCycle();

    await expenses.markDeletedByApp(database, created.id, 'misha');
    oneDrive.locked = false;
    const result = await sync.requestCycle();

    expect(result).toMatchObject({ written: 0, removed: 0 });
    expect(await count(coffee)).toBe(0);
  });

  it('строка пропала из Excel сама, пока удаление ждало: снимок просто сбрасывается', async () => {
    const record = await syncedRecord();
    await expenses.markDeletedByApp(database, record.id, 'misha');
    oneDrive.remote = await (
      await import('../../src/services/excel/edit.ts')
    ).applyEditsToBuffer(
      oneDrive.remote,
      { updates: [], removals: [coffee], appends: [] },
      excelOptions,
    );

    const result = await sync.requestCycle();

    expect(result).toMatchObject({ status: 'ok', removed: 0, deleted: 0, imported: 0 });
    expect((await reload(record.id)).excelSnapshot).toBeNull();
  });
});

describe('возврат удалённой записи', () => {
  it('строка уже убрана из Excel: запись встаёт в очередь и дописывается снова', async () => {
    const record = await syncedRecord();
    await expenses.markDeletedByApp(database, record.id, 'misha');
    await sync.requestCycle();

    await expenses.restoreByApp(database, record.id, 'misha');
    const result = await sync.requestCycle();

    expect(result.written).toBe(1);
    expect(await count(coffee)).toBe(1);
    expect(await reload(record.id)).toMatchObject({ deletedAt: null, excelStatus: 'synced' });
  });

  it('строка ещё не убрана: возврат отменяет удаление, Excel не меняется', async () => {
    const record = await syncedRecord();
    await expenses.markDeletedByApp(database, record.id, 'misha');
    await expenses.restoreByApp(database, record.id, 'misha');
    const uploads = oneDrive.uploads;

    const result = await sync.requestCycle();

    expect(result).toMatchObject({ written: 0, removed: 0, updated: 0 });
    expect(oneDrive.uploads).toBe(uploads);
    expect(await count(coffee)).toBe(1);
  });

  it('правка и удаление вместе с возвратом в одном проходе', async () => {
    const a = await syncedRecord(coffee);
    const b = await syncedRecord(bread);
    await expenses.updateValues(database, a.id, { ...coffee, amount: 1 }, 'misha', false);
    await expenses.markDeletedByApp(database, b.id, 'misha');

    const result = await sync.requestCycle();

    expect(result).toMatchObject({ updated: 1, removed: 1 });
    expect(await count({ ...coffee, amount: 1 })).toBe(1);
    expect(await count(bread)).toBe(0);
  });
});

describe('сбои', () => {
  it('загрузка отклонена: изменения остаются в очереди, повтор их применяет', async () => {
    const record = await syncedRecord();
    await expenses.updateValues(database, record.id, { ...coffee, amount: 3 }, 'misha', false);
    oneDrive.failBeforeUpload = new OneDriveError('FILE_LOCKED', 'locked');

    const failed = await sync.requestCycle();

    expect(failed.status).not.toBe('ok');
    expect(await count(coffee)).toBe(1);
    expect((await reload(record.id)).excelSnapshot).toEqual(coffee);

    oneDrive.failBeforeUpload = undefined;
    await sync.requestCycle();
    expect(await count({ ...coffee, amount: 3 })).toBe(1);
  });

  it('ответ о загрузке потерян, а файл изменён: данные не теряются (запись заменяется такой же из Excel)', async () => {
    const record = await syncedRecord();
    const changed = { ...coffee, amount: 4 };
    await expenses.updateValues(database, record.id, changed, 'misha', false);
    oneDrive.failAfterUpload = new Error('connection reset');

    await sync.requestCycle();
    oneDrive.failAfterUpload = undefined;
    await sync.requestCycle();

    expect(await count(changed)).toBe(1);
    const active = (await expenses.listForReconcile(database)).filter(
      (r) => r.deletedAt === null && r.name === 'Кофе',
    );
    expect(active.map(values)).toEqual([changed]);
  });

  it('строки для правки нет в Excel (файл подменили, массовое удаление заблокировано): ошибка без изменения файла', async () => {
    const record = await syncedRecord();
    await expenses.updateValues(database, record.id, { ...coffee, amount: 5 }, 'misha', false);
    const before = Buffer.from(oneDrive.remote);
    // Too many rows vanished from Excel at once: the safeguard prevents marking them deleted
    const all = await excel();
    oneDrive.remote = await (
      await import('../../src/services/excel/edit.ts')
    ).applyEditsToBuffer(
      oneDrive.remote,
      { updates: [], removals: [coffee, ...all.slice(0, 19)], appends: [] },
      excelOptions,
    );
    const afterRemoval = Buffer.from(oneDrive.remote);

    const result = await sync.requestCycle();

    expect(result.status).toBe('error');
    expect(result.error?.code).toBe('ROW_NOT_FOUND');
    expect(oneDrive.remote.equals(afterRemoval)).toBe(true);
    expect(before.equals(afterRemoval)).toBe(false);
  });
});

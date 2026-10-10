import { readFile } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { BackupStore } from '../../src/infrastructure/backup/backup.service.ts';
import type { Database } from '../../src/infrastructure/database/database.ts';
import { SyncService } from '../../src/modules/sync/sync.service.ts';
import { SyncStateRepository } from '../../src/modules/sync/sync-state.repository.ts';
import { appendExpenseToBuffer, readExcelExpenses } from '../../src/services/excel.service.ts';
import { OneDriveError } from '../../src/services/onedrive/errors.ts';
import type { Expense } from '../../src/storage/expense.repository.ts';
import { PostgresExpenseRepository } from '../../src/storage/postgres/postgres.repository.ts';
import { createTestDatabase } from '../helpers/test-database.ts';
import { FakeOneDrive } from '../helpers/fake-onedrive.ts';

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
  date: '2026-10-11',
  card: 'Настя',
  category: 'продукты',
  name: 'Хлеб',
  amount: 300,
};

let database: Database;
let expenses: PostgresExpenseRepository;
let oneDrive: FakeOneDrive;
let sync: SyncService;
let backups: { saved: number; failWith?: Error } & BackupStore;
let excelRowCount: number;

const queue = (expense: Expense) => expenses.insertPending(database, expense, 'misha');
const excelRows = async () => (await readExcelExpenses(oneDrive.remote, excelOptions)).expenses;
const statusOf = async (id: string) => (await expenses.findById(id))?.excelStatus;

beforeEach(async () => {
  database = await createTestDatabase();
  expenses = new PostgresExpenseRepository(database);
  oneDrive = new FakeOneDrive(await readFile(FIXTURE));
  excelRowCount = (await excelRows()).length;

  backups = {
    saved: 0,
    async save() {
      if (this.failWith) throw this.failWith;
      this.saved++;
      return '/backups/x.xlsx';
    },
  };
  sync = new SyncService({
    database,
    expenses,
    oneDrive,
    backups,
    excelOptions,
    state: new SyncStateRepository(database),
  });
});

afterEach(() => database.close());

describe('импорт из Excel', () => {
  it('первая синхронизация переносит все строки Excel в БД', async () => {
    const result = await sync.requestCycle();

    expect(result).toMatchObject({
      status: 'ok',
      imported: excelRowCount,
      written: 0,
      queued: 0,
      diverged: 0,
    });
    expect((await expenses.listForReconcile(database)).every((e) => e.source === 'excel')).toBe(
      true,
    );
    // Ничего не меняли в Excel: ни копии, ни загрузки
    expect(oneDrive.uploads).toBe(0);
    expect(backups.saved).toBe(0);
  });

  it('повторная синхронизация ничего не импортирует', async () => {
    await sync.requestCycle();

    const second = await sync.requestCycle();

    expect(second.imported).toBe(0);
    expect(await expenses.listForReconcile(database)).toHaveLength(excelRowCount);
  });

  it('подхватывает строки, добавленные в Excel вручную', async () => {
    await sync.requestCycle();
    oneDrive.remote = (await appendExpenseToBuffer(oneDrive.remote, bread, excelOptions)).output;

    const result = await sync.requestCycle();

    expect(result.imported).toBe(1);
    const all = await expenses.listForReconcile(database);
    expect(all.at(-1)).toMatchObject({ ...bread, source: 'excel', excelStatus: 'synced' });
  });

  it('сообщает о строках, которые нельзя импортировать, и не падает', async () => {
    const broken = await readFile(FIXTURE);
    oneDrive.remote = (await appendExpenseToBuffer(broken, coffee, excelOptions)).output;
    // Заменяем стоимость добавленной строки на дробную
    const JSZip = (await import('jszip')).default;
    const zip = await JSZip.loadAsync(oneDrive.remote);
    const xml = await zip.file('xl/worksheets/sheet1.xml')!.async('string');
    zip.file(
      'xl/worksheets/sheet1.xml',
      xml.replace(/(<c r="E41"[^>]*>)<v>640<\/v>/, '$1<v>6.5</v>'),
    );
    oneDrive.remote = await zip.generateAsync({ type: 'nodebuffer' });

    const result = await sync.requestCycle();

    expect(result.status).toBe('ok');
    expect(result.skipped).toBe(1);
    expect(result.skippedRows[0]).toMatchObject({ row: 41 });
    expect(result.imported).toBe(excelRowCount);
  });

  it('удалённая в Excel строка считается расхождением и не удаляется из БД', async () => {
    await sync.requestCycle();
    await database.query(
      `INSERT INTO expenses (id, date, card, category, name, amount, source, excel_status, created_by)
       VALUES (gen_random_uuid(), '2020-01-01', 'Миша', 'кафе', 'Нет в Excel', 100, 'excel', 'synced', 'excel')`,
    );

    const result = await sync.requestCycle();

    expect(result.diverged).toBe(1);
    expect(await expenses.listForReconcile(database)).toHaveLength(excelRowCount + 1);
  });
});

describe('запись очереди в Excel', () => {
  it('дописывает записи из очереди одним проходом: одна копия и одна загрузка', async () => {
    await sync.requestCycle();
    const first = await queue(coffee);
    const second = await queue(bread);

    const result = await sync.requestCycle();

    expect(result).toMatchObject({ status: 'ok', written: 2, queued: 0, imported: 0 });
    expect((await excelRows()).slice(-2)).toEqual([coffee, bread]);
    expect(await statusOf(first.id)).toBe('synced');
    expect(await statusOf(second.id)).toBe('synced');
    expect(backups.saved).toBe(1);
    expect(oneDrive.uploads).toBe(1);
  });

  it('собственные записи не импортируются из Excel повторно', async () => {
    await queue(coffee);
    await sync.requestCycle();

    const again = await sync.requestCycle();

    expect(again.imported).toBe(0);
    expect(await expenses.listForReconcile(database)).toHaveLength(excelRowCount + 1);
  });

  it('два одинаковых расхода остаются двумя строками', async () => {
    await sync.requestCycle();
    await queue(coffee);
    await queue(coffee);

    await sync.requestCycle();

    expect((await excelRows()).filter((e) => e.name === 'Кофе')).toHaveLength(2);
    expect((await sync.requestCycle()).imported).toBe(0);
  });

  it('резервная копия делается до загрузки; без неё файл не меняется', async () => {
    const item = await queue(coffee);
    backups.failWith = new Error('disk full');
    const before = oneDrive.remote;

    const result = await sync.requestCycle();

    expect(result).toMatchObject({ status: 'error', error: { code: 'BACKUP_FAILED' }, queued: 1 });
    expect(oneDrive.uploads).toBe(0);
    expect(oneDrive.remote).toBe(before);
    expect(await statusOf(item.id)).toBe('pending');
  });
});

describe('Excel открыт (файл заблокирован)', () => {
  it('запись остаётся в очереди, а строки из Excel всё равно импортируются', async () => {
    const item = await queue(coffee);
    oneDrive.locked = true;

    const result = await sync.requestCycle();

    expect(result).toMatchObject({
      status: 'locked',
      written: 0,
      queued: 1,
      imported: excelRowCount,
    });
    expect(result.error?.code).toBe('FILE_LOCKED');
    expect(await statusOf(item.id)).toBe('pending');
    const [attempts] = await database.query<{ excel_attempts: number }>(
      'SELECT excel_attempts FROM expenses WHERE id = $1',
      [item.id],
    );
    expect(attempts?.excel_attempts).toBe(1);
  });

  it('после освобождения файла очередь записывается сама', async () => {
    const item = await queue(coffee);
    oneDrive.locked = true;
    await sync.requestCycle();

    oneDrive.locked = false;
    const result = await sync.requestCycle();

    expect(result).toMatchObject({ status: 'ok', written: 1, queued: 0 });
    expect(await statusOf(item.id)).toBe('synced');
    expect((await excelRows()).at(-1)).toEqual(coffee);
  });

  it('порядок записи в очереди сохраняется', async () => {
    oneDrive.locked = true;
    await queue({ ...coffee, name: 'Первый' });
    await sync.requestCycle();
    await queue({ ...coffee, name: 'Второй' });
    await sync.requestCycle();

    oneDrive.locked = false;
    await sync.requestCycle();

    expect((await excelRows()).slice(-2).map((e) => e.name)).toEqual(['Первый', 'Второй']);
  });
});

describe('сбои', () => {
  it('файл изменили во время записи: цикл повторяется и запись проходит', async () => {
    await sync.requestCycle();
    const item = await queue(coffee);
    let edited = false;
    oneDrive.afterDownload = () => {
      if (edited) return;
      edited = true;
      // Кто-то добавил строку в Excel, пока мы работали
      void appendExpenseToBuffer(oneDrive.remote, bread, excelOptions).then(
        (r) => (oneDrive.remote = r.output),
      );
    };
    // Дожидаемся асинхронной правки до загрузки
    const original = oneDrive.uploadFile.bind(oneDrive);
    oneDrive.uploadFile = async (path, version) => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      return original(path, version);
    };

    const result = await sync.requestCycle();

    expect(result).toMatchObject({ status: 'ok', written: 1 });
    expect(await statusOf(item.id)).toBe('synced');
    const names = (await excelRows()).map((e) => e.name);
    expect(names.slice(-2).sort()).toEqual(['Кофе', 'Хлеб'].sort());
    // Чужая строка тоже попала в БД
    expect((await expenses.listForReconcile(database)).some((e) => e.name === 'Хлеб')).toBe(true);
  });

  it('загрузка применилась, но ответ потерян: запись не дублируется', async () => {
    await sync.requestCycle();
    const item = await queue(coffee);
    oneDrive.failAfterUpload = new OneDriveError('NETWORK', 'connection reset');

    const failed = await sync.requestCycle();

    expect(failed.status).toBe('unavailable');
    expect(await statusOf(item.id)).toBe('writing');

    oneDrive.failAfterUpload = undefined;
    const recovered = await sync.requestCycle();

    expect(recovered).toMatchObject({ status: 'ok', written: 0, imported: 0, queued: 0 });
    expect(await statusOf(item.id)).toBe('synced');
    expect((await excelRows()).filter((e) => e.name === 'Кофе')).toHaveLength(1);
  });

  it('загрузка не применилась и ответ потерян: запись возвращается в очередь и доходит', async () => {
    await sync.requestCycle();
    const item = await queue(coffee);
    oneDrive.failBeforeUpload = new OneDriveError('NETWORK', 'connection reset');
    await sync.requestCycle();
    expect(await statusOf(item.id)).toBe('writing');

    oneDrive.failBeforeUpload = undefined;
    const recovered = await sync.requestCycle();

    expect(recovered).toMatchObject({ status: 'ok', written: 1 });
    expect(await statusOf(item.id)).toBe('synced');
    expect((await excelRows()).filter((e) => e.name === 'Кофе')).toHaveLength(1);
  });

  it('OneDrive недоступен: запись остаётся в очереди', async () => {
    const item = await queue(coffee);
    oneDrive.downloadError = new OneDriveError('NETWORK', 'offline');

    const result = await sync.requestCycle();

    expect(result).toMatchObject({ status: 'unavailable', queued: 1, imported: 0 });
    expect(await statusOf(item.id)).toBe('pending');
  });

  it('повреждённый Excel: статус error, очередь цела', async () => {
    const item = await queue(coffee);
    oneDrive.remote = Buffer.from('not an xlsx');

    const result = await sync.requestCycle();

    expect(result.status).toBe('error');
    expect(await statusOf(item.id)).toBe('pending');
  });
});

describe('запуск циклов', () => {
  it('одновременные запросы объединяются: не больше двух циклов', async () => {
    const results = await Promise.all([
      sync.requestCycle(),
      sync.requestCycle(),
      sync.requestCycle(),
    ]);

    expect(oneDrive.downloads).toBeLessThanOrEqual(2);
    expect(results[1]).toBe(results[2]);
  });

  it('запрос во время цикла получает цикл, начатый после него, и видит новую запись', async () => {
    // Первый цикл останавливаем перед загрузкой: очередь он уже прочитал
    let release!: () => void;
    oneDrive.uploadGate = new Promise<void>((resolve) => (release = resolve));
    const uploadStarted = new Promise<void>((resolve) => (oneDrive.onUploadStart = resolve));
    await queue(bread);
    const first = sync.requestCycle();
    await uploadStarted;

    const late = await queue(coffee);
    const second = sync.requestCycle();
    release();

    expect((await first).written).toBe(1);
    expect((await second).written).toBe(1);
    expect(await statusOf(late.id)).toBe('synced');
  });

  it('результат сохраняется и виден в статусе', async () => {
    await queue(coffee);
    await sync.requestCycle();

    const status = await sync.status();

    expect(status).toMatchObject({
      queued: 0,
      running: false,
      lastResult: { status: 'ok', written: 1 },
    });
    expect(await new SyncStateRepository(database).get()).toMatchObject({ status: 'ok' });
  });
});

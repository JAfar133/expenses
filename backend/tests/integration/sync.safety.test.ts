import { readFile } from 'node:fs/promises';
import JSZip from 'jszip';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { BackupStore } from '../../src/infrastructure/backup/backup.service.ts';
import type { Database } from '../../src/infrastructure/database/database.ts';
import { SyncService } from '../../src/modules/sync/sync.service.ts';
import { SyncStateRepository } from '../../src/modules/sync/sync-state.repository.ts';
import { appendExpenseToBuffer, readExcelExpenses } from '../../src/services/excel.service.ts';
import { ExcelStructureError } from '../../src/services/excel/errors.ts';
import { locateTable } from '../../src/services/excel/locate-table.ts';
import { findLastFilledRow, writeExpenseRow } from '../../src/services/excel/sheet-rows.ts';
import { readTableRange, replaceTableRef } from '../../src/services/excel/table.ts';
import type { Expense } from '../../src/storage/expense.repository.ts';
import { PostgresExpenseRepository } from '../../src/storage/postgres/postgres.repository.ts';
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
let saveHook: (() => Promise<void>) | undefined;
let fixture: Buffer;

const excel = async () => (await readExcelExpenses(oneDrive.remote, options)).expenses;
const countOf = async (expense: Expense) =>
  (await excel()).filter((e) => JSON.stringify(e) === JSON.stringify(expense)).length;

/** The workbook with the table cut to the last filled row and the given row edited in the sheet XML. */
async function editSheet(source: Buffer, edit: (sheetXml: string, lastRow: number) => string) {
  const zip = await JSZip.loadAsync(source);
  const { sheetPath, sheetXml, tableXml, tablePath } = await locateTable(zip, options);
  const { ref, range } = readTableRange(tableXml);
  const lastFilled = findLastFilledRow(sheetXml, range.headerRow, range.lastRow);
  zip.file(sheetPath, edit(sheetXml, lastFilled));
  zip.file(tablePath, replaceTableRef(tableXml, ref, `A${range.headerRow}:E${lastFilled}`));
  return zip.generateAsync({ type: 'nodebuffer' });
}

const startSync = async (remote: Buffer) => {
  database = await createTestDatabase();
  expenses = new PostgresExpenseRepository(database);
  oneDrive = new FakeOneDrive(remote);
  const backups = {
    async save() {
      await saveHook?.();
      return '/backups/x.xlsx';
    },
  } as BackupStore;
  sync = new SyncService({
    database,
    expenses,
    oneDrive,
    backups,
    excelOptions: options,
    state: new SyncStateRepository(database),
  });
};

beforeEach(async () => {
  saveHook = undefined;
  fixture = await readFile(FIXTURE);
});

afterEach(async () => {
  await database?.close();
  database = undefined as unknown as Database;
});

describe('запись под таблицей', () => {
  it('данные сразу под таблицей не затираются: добавление отклоняется', async () => {
    const blocked = await editSheet(fixture, (xml, lastRow) =>
      writeExpenseRow(xml, lastRow + 1, lastRow, { ...coffee, name: 'Чужая запись' }),
    );

    await expect(appendExpenseToBuffer(blocked, coffee, options)).rejects.toMatchObject({
      name: 'ExcelStructureError',
      code: 'TABLE_BLOCKED',
    });
    await expect(appendExpenseToBuffer(blocked, coffee, options)).rejects.toBeInstanceOf(
      ExcelStructureError,
    );
  });

  it('синхронизация не загружает файл, запись остаётся в очереди, ошибка понятная', async () => {
    const blocked = await editSheet(fixture, (xml, lastRow) =>
      writeExpenseRow(xml, lastRow + 1, lastRow, { ...coffee, name: 'Чужая запись' }),
    );
    await startSync(blocked);
    await expenses.insertPending(database, coffee, 'misha');

    const result = await sync.requestCycle();

    expect(result.status).toBe('error');
    expect(result.error?.code).toBe('TABLE_BLOCKED');
    expect(oneDrive.uploads).toBe(0);
    expect(await expenses.countQueue()).toBe(1);
    const stillThere = await JSZip.loadAsync(oneDrive.remote);
    expect(await stillThere.file('xl/worksheets/sheet1.xml')!.async('string')).toContain(
      'Чужая запись',
    );
  });

  it('пустая строка под таблицей не мешает: таблица расширяется', async () => {
    const tight = await editSheet(fixture, (xml) => xml);

    const { result } = await appendExpenseToBuffer(tight, coffee, options);

    expect(result.tableExtended).toBe(true);
  });
});

describe('структура таблицы проверяется до изменений в базе', () => {
  it('переименованный заголовок: цикл останавливается, записи в базе не меняются', async () => {
    await startSync(fixture);
    await sync.requestCycle();
    const before = await expenses.listForReconcile(database);
    const zip = await JSZip.loadAsync(oneDrive.remote);
    const { tablePath, tableXml } = await locateTable(zip, options);
    zip.file(tablePath, tableXml.replace('name="стоимость"', 'name="сумма"'));
    oneDrive.remote = await zip.generateAsync({ type: 'nodebuffer' });

    const result = await sync.requestCycle();

    expect(result.status).toBe('error');
    expect(result.error?.code).toBe('TABLE_UNSUPPORTED');
    const after = await expenses.listForReconcile(database);
    expect(after.filter((r) => r.deletedAt !== null)).toHaveLength(0);
    expect(after).toHaveLength(before.length);
  });
});

describe('строки, которые не удалось прочитать', () => {
  it('запись с испорченной строкой не удаляется, остальные синхронизируются', async () => {
    await startSync(fixture);
    await sync.requestCycle();
    const before = await expenses.listForReconcile(database);

    // The cost of one row became text: the row is no longer readable
    const zip = await JSZip.loadAsync(oneDrive.remote);
    const { sheetPath, sheetXml } = await locateTable(zip, options);
    const damaged = sheetXml.replace(
      /(<c r="E5"[^>]*?)( t="\w+")?>\s*<v>[^<]*<\/v>/,
      '$1 t="inlineStr"><is><t>abc</t></is>',
    );
    expect(damaged).not.toBe(sheetXml);
    zip.file(sheetPath, damaged);
    oneDrive.remote = await zip.generateAsync({ type: 'nodebuffer' });

    const result = await sync.requestCycle();

    expect(result.skipped).toBe(1);
    expect(result.deleted).toBe(0);
    expect(result.warning?.code).toBe('UNREADABLE_ROWS');
    const after = await expenses.listForReconcile(database);
    expect(after.filter((r) => r.deletedAt !== null)).toHaveLength(0);
    expect(after).toHaveLength(before.length);
  });
});

describe('правка записи, пока готовится файл', () => {
  it('в Excel уходят отправленные значения, а последняя правка доезжает следующим циклом', async () => {
    await startSync(fixture);
    await sync.requestCycle();
    const created = await expenses.insertPending(database, coffee, 'misha');
    const edited = { ...coffee, name: 'Кофе с сиропом', amount: 900 };
    // The user edits the record after its values were taken for the file, before the upload
    saveHook = async () => {
      saveHook = undefined;
      await expenses.updateValues(database, created.id, edited, 'misha', false);
    };

    await sync.requestCycle();

    expect(await countOf(coffee)).toBe(1);
    expect(await countOf(edited)).toBe(0);
    const middle = (await expenses.findById(created.id))!;
    expect(middle).toMatchObject({ ...edited, excelSnapshot: coffee, excelStatus: 'synced' });

    const second = await sync.requestCycle();

    expect(second).toMatchObject({ status: 'ok', updated: 1, deleted: 0, imported: 0 });
    expect(await countOf(edited)).toBe(1);
    expect(await countOf(coffee)).toBe(0);
    const all = await expenses.listForReconcile(database);
    expect(all.filter((r) => r.name.startsWith('Кофе'))).toHaveLength(1);
    expect(all.filter((r) => r.deletedAt !== null)).toHaveLength(0);
  });
});

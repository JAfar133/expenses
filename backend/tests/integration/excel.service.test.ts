import { readFile } from 'node:fs/promises';
import JSZip from 'jszip';
import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import {
  appendExpenseToBuffer,
  toExcelSerial,
  type Expense,
} from '../../src/services/excel.service.ts';

// Типы exceljs объявляют устаревший Buffer, поэтому приводим явно
const asExcelJsBuffer = (data: Uint8Array) => data as unknown as ExcelJS.Buffer;

const opts = { sheetName: 'Лист1', tableName: 'Операции' };
const fixture = await readFile(new URL('../fixtures/expenses-dev.xlsx', import.meta.url));
const exp = (o: Partial<Expense> = {}): Expense => ({
  date: '2026-10-10',
  card: 'Миша',
  category: 'продукты',
  name: 'Тестовая покупка',
  amount: 1500,
  ...o,
});

async function addN(n: number, mk: (i: number) => Expense = () => exp()) {
  let buf: Buffer = fixture;
  const results = [];
  for (let i = 0; i < n; i++) {
    const r = await appendExpenseToBuffer(buf, mk(i), opts);
    buf = r.output;
    results.push(r.result);
  }
  return { buf, results };
}

const tableRef = async (b: Uint8Array) =>
  /ref="([^"]*)"/.exec(
    await (await JSZip.loadAsync(b)).file('xl/tables/table1.xml')!.async('string'),
  )![1];

describe('toExcelSerial', () => {
  it('не зависит от часового пояса', () => {
    expect(toExcelSerial('2026-10-10')).toBe(46305);
    expect(toExcelSerial('1900-03-01')).toBe(61);
  });
  it('отклоняет невалидные даты', () => {
    expect(() => toExcelSerial('2026-02-30')).toThrow();
    expect(() => toExcelSerial('10.10.2026')).toThrow();
  });
});

describe('appendExpenseToBuffer', () => {
  it('использует свободную строку внутри таблицы', async () => {
    const { buf, results } = await addN(1);
    expect(results[0]).toEqual({ row: 41, tableRef: 'A1:E42', tableExtended: false });
    expect(await tableRef(buf)).toBe('A1:E42');
  });

  it('расширяет таблицу, когда свободных строк нет', async () => {
    const { buf, results } = await addN(3);
    expect(results[2]).toEqual({ row: 43, tableRef: 'A1:E43', tableExtended: true });
    expect(await tableRef(buf)).toBe('A1:E43');
  });

  it('пишет типы и форматы, не трогает старые строки', async () => {
    const before = new ExcelJS.Workbook();
    await before.xlsx.load(asExcelJsBuffer(fixture));
    const { buf } = await addN(3);
    const after = new ExcelJS.Workbook();
    await after.xlsx.load(asExcelJsBuffer(buf));
    const a = before.getWorksheet('Лист1')!,
      b = after.getWorksheet('Лист1')!;
    for (let r = 1; r <= 40; r++) expect(b.getRow(r).values).toEqual(a.getRow(r).values);
    const row = b.getRow(43);
    expect(row.getCell(1).value).toEqual(new Date('2026-10-10T00:00:00.000Z'));
    expect(row.getCell(1).numFmt).toBe('dd.mm.yy');
    expect(row.getCell(5).value).toBe(1500);
    expect(row.getCell(5).numFmt).toBe('#,##0');
  });

  it('сохраняет остальные части книги побайтово (графики и т.д.)', async () => {
    const { buf } = await addN(3);
    const a = await JSZip.loadAsync(fixture),
      b = await JSZip.loadAsync(buf);
    const changed: string[] = [];
    for (const n of Object.keys(a.files)) {
      if (a.files[n]!.dir) continue;
      if (
        Buffer.compare(
          await a.file(n)!.async('nodebuffer'),
          await b.file(n)!.async('nodebuffer'),
        ) !== 0
      )
        changed.push(n);
    }
    expect(changed.sort()).toEqual(['xl/tables/table1.xml', 'xl/worksheets/sheet1.xml']);
    expect(Object.keys(b.files).some((n) => n.startsWith('xl/charts/'))).toBe(true);
  });

  it('записывает формулы и спецсимволы как текст', async () => {
    const { buf } = await addN(1, () => exp({ name: '=HYPERLINK("x") & <b>' }));
    const sheet = await (
      await JSZip.loadAsync(buf)
    )
      .file('xl/worksheets/sheet1.xml')!
      .async('string');
    expect(sheet).toContain('t="inlineStr"');
    expect(sheet).not.toMatch(/<f>[^<]*HYPERLINK/);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(asExcelJsBuffer(buf));
    expect(wb.getWorksheet('Лист1')!.getCell('D41').value).toBe('=HYPERLINK("x") & <b>');
  });

  it('отклоняет некорректные данные и неизвестные листы/таблицы', async () => {
    await expect(appendExpenseToBuffer(fixture, exp({ amount: 0 }), opts)).rejects.toThrow();
    await expect(appendExpenseToBuffer(fixture, exp({ name: '  ' }), opts)).rejects.toThrow();
    await expect(
      appendExpenseToBuffer(fixture, exp(), { ...opts, tableName: 'Нет' }),
    ).rejects.toThrow(/Table not found/);
    await expect(
      appendExpenseToBuffer(fixture, exp(), { ...opts, sheetName: 'Нет' }),
    ).rejects.toThrow(/Sheet not found/);
  });

  it('падает на повреждённом файле', async () => {
    await expect(appendExpenseToBuffer(Buffer.from('not a zip'), exp(), opts)).rejects.toThrow();
  });
});

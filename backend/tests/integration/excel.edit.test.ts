import { readFile } from 'node:fs/promises';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { appendExpensesToBuffer, type Expense } from '../../src/services/excel.service.ts';
import { applyEditsToBuffer, ExcelEditError } from '../../src/services/excel/edit.ts';
import { readExcelTable } from '../../src/services/excel/read.ts';

const opts = { sheetName: 'Лист1', tableName: 'Операции' };
const fixture = await readFile(new URL('../fixtures/expenses-dev.xlsx', import.meta.url));
const SHEET = 'xl/worksheets/sheet1.xml';

const exp = (overrides: Partial<Expense> = {}): Expense => ({
  date: '2026-10-10',
  card: 'Миша',
  category: 'продукты',
  name: 'Тестовая покупка',
  amount: 1500,
  ...overrides,
});

const NONE = { updates: [], removals: [], appends: [] };

const tableRef = async (buffer: Buffer) =>
  /ref="([^"]*)"/.exec(
    await (await JSZip.loadAsync(buffer)).file('xl/tables/table1.xml')!.async('string'),
  )![1];

const read = (buffer: Buffer) => readExcelTable(buffer, opts);
const table = async (buffer: Buffer) => (await read(buffer)).expenses;

/** Styles of cells A:E of a sheet row: show that the formatting did not shift. */
async function styles(buffer: Buffer, rows: number[]) {
  const xml = await (await JSZip.loadAsync(buffer)).file(SHEET)!.async('string');
  return rows.map((row) =>
    ['A', 'B', 'C', 'D', 'E'].map((column) => {
      const cell = new RegExp(`<c r="${column}${row}"([^>]*?)(?:/>|>)`).exec(xml);
      return /\bs="(\d+)"/.exec(cell?.[1] ?? '')?.[1] ?? '';
    }),
  );
}

async function withAppended(expenses: Expense[]) {
  return (await appendExpensesToBuffer(fixture, expenses, opts)).output;
}

const original = await table(fixture);
const originalRows = (await read(fixture)).rows;

describe('замена строки', () => {
  it('меняет значения в той же строке, остальные строки и порядок не трогает', async () => {
    const target = original[5]!;
    const changed = { ...target, name: 'Исправлено', amount: 12345 };

    const output = await applyEditsToBuffer(
      fixture,
      { ...NONE, updates: [{ from: target, to: changed }] },
      opts,
    );

    const after = await table(output);
    expect(after).toHaveLength(original.length);
    expect(after[5]).toEqual(changed);
    expect(after.filter((_, i) => i !== 5)).toEqual(original.filter((_, i) => i !== 5));
    expect((await read(output)).rows[5]!.row).toBe(originalRows[5]!.row);
  });

  it('сохраняет стили ячеек', async () => {
    const rowNumbers = originalRows.slice(4, 8).map((r) => r.row);
    const before = await styles(fixture, rowNumbers);

    const output = await applyEditsToBuffer(
      fixture,
      { ...NONE, updates: [{ from: original[5]!, to: exp({ name: 'Другое' }) }] },
      opts,
    );

    expect(await styles(output, rowNumbers)).toEqual(before);
  });

  it('остальные части книги остаются побайтово теми же', async () => {
    const output = await applyEditsToBuffer(
      fixture,
      { ...NONE, updates: [{ from: original[3]!, to: exp() }] },
      opts,
    );

    const [a, b] = await Promise.all([JSZip.loadAsync(fixture), JSZip.loadAsync(output)]);
    const names = Object.keys(a.files).filter((n) => !a.files[n]!.dir && n !== SHEET);
    for (const name of names) {
      expect(await b.file(name)!.async('uint8array'), name).toEqual(
        await a.file(name)!.async('uint8array'),
      );
    }
  });

  it('формулы и спецсимволы записываются как текст', async () => {
    const name = '=HYPERLINK("x") & <b> & ампер';

    const output = await applyEditsToBuffer(
      fixture,
      { ...NONE, updates: [{ from: original[2]!, to: exp({ name }) }] },
      opts,
    );

    expect((await table(output))[2]!.name).toBe(name);
    const xml = await (await JSZip.loadAsync(output)).file(SHEET)!.async('string');
    expect(xml).not.toMatch(/<f>.*HYPERLINK/);
  });

  it('две замены не мешают друг другу, в том числе обмен значениями между строками', async () => {
    const [a, b] = [original[1]!, original[2]!];

    const output = await applyEditsToBuffer(
      fixture,
      {
        ...NONE,
        updates: [
          { from: a, to: b },
          { from: b, to: a },
        ],
      },
      opts,
    );

    const after = await table(output);
    expect([after[1], after[2]]).toEqual([b, a]);
  });

  it('одинаковых строк несколько: меняется одна из них', async () => {
    const twin = exp({ name: 'Близнец' });
    const base = await withAppended([twin, twin]);
    const changed = exp({ name: 'Близнец', amount: 999 });

    const output = await applyEditsToBuffer(
      base,
      { ...NONE, updates: [{ from: twin, to: changed }] },
      opts,
    );

    const after = await table(output);
    expect(
      after
        .filter((e) => e.name === 'Близнец')
        .map((e) => e.amount)
        .sort((a, b) => a - b),
    ).toEqual([999, 1500]);
  });
});

describe('удаление строки', () => {
  it('значения ниже сдвигаются вверх, последняя строка очищается, таблица не меняется', async () => {
    const output = await applyEditsToBuffer(fixture, { ...NONE, removals: [original[5]!] }, opts);

    const after = await read(output);
    expect(after.expenses).toEqual(original.filter((_, i) => i !== 5));
    // Rows are contiguous with no gap: the last filled row is now one higher
    expect(after.rows.at(-1)!.row).toBe(originalRows.at(-1)!.row - 1);
    expect(after.rows.map((r) => r.row)).toEqual(originalRows.slice(0, -1).map((r) => r.row));
    // The table range is unchanged
    expect(await tableRef(output)).toBe(await tableRef(fixture));
  });

  it.each([
    ['первую', 0],
    ['последнюю', original.length - 1],
  ])('удаляет %s строку таблицы', async (_title, index) => {
    const output = await applyEditsToBuffer(
      fixture,
      { ...NONE, removals: [original[index]!] },
      opts,
    );

    expect(await table(output)).toEqual(original.filter((_, i) => i !== index));
  });

  it('несколько строк сразу, в том числе соседние', async () => {
    const indexes = [3, 4, 5, 20, original.length - 1];

    const output = await applyEditsToBuffer(
      fixture,
      { ...NONE, removals: indexes.map((i) => original[i]!) },
      opts,
    );

    expect(await table(output)).toEqual(original.filter((_, i) => !indexes.includes(i)));
  });

  it('оформление строк не съезжает при сдвиге', async () => {
    const rowNumbers = originalRows.map((r) => r.row);
    const before = await styles(fixture, rowNumbers);

    const output = await applyEditsToBuffer(fixture, { ...NONE, removals: [original[2]!] }, opts);

    expect(await styles(output, rowNumbers)).toEqual(before);
  });

  it('одинаковых строк несколько: убирается ровно одна', async () => {
    const twin = exp({ name: 'Близнец' });
    const base = await withAppended([twin, twin, twin]);

    const output = await applyEditsToBuffer(base, { ...NONE, removals: [twin] }, opts);

    expect((await table(output)).filter((e) => e.name === 'Близнец')).toHaveLength(2);
    expect(await table(output)).toHaveLength(original.length + 2);
  });

  it('добавление и удаление взаимно обратимы', async () => {
    const added = [exp({ name: 'А' }), exp({ name: 'Б' }), exp({ name: 'В' })];
    const base = await withAppended(added);

    const output = await applyEditsToBuffer(base, { ...NONE, removals: added }, opts);

    expect(await table(output)).toEqual(original);
  });

  it('если ниже есть нечитаемая строка, строки не сдвигаются: удаляемая очищается, порядок сохраняется', async () => {
    const zip = await JSZip.loadAsync(fixture);
    const xml = await zip.file(SHEET)!.async('string');
    const brokenRow = originalRows[10]!.row;
    // Corrupt the cost of the row below the one being deleted: a fractional number
    zip.file(
      SHEET,
      xml.replace(new RegExp(`(<c r="E${brokenRow}"[^>]*>)<v>[^<]*</v>`), '$1<v>12.5</v>'),
    );
    const damaged = await zip.generateAsync({ type: 'nodebuffer' });
    const before = await read(damaged);
    expect(before.invalidRows).toEqual([brokenRow]);

    const output = await applyEditsToBuffer(damaged, { ...NONE, removals: [original[2]!] }, opts);

    const after = await read(output);
    expect(after.invalidRows).toEqual([brokenRow]); // the unreadable row stayed in place
    // Row 2 is deleted, the other readable rows are in place and in the same order
    expect(after.expenses).toEqual(before.expenses.filter((_, index) => index !== 2));
    expect(after.rows.find((r) => r.row === originalRows[3]!.row)?.expense).toEqual(original[3]);
  });
});

describe('всё вместе и ошибки', () => {
  it('замена, удаление и добавление за один проход', async () => {
    const output = await applyEditsToBuffer(
      fixture,
      {
        updates: [{ from: original[1]!, to: exp({ name: 'Новое имя' }) }],
        removals: [original[7]!],
        appends: [exp({ name: 'Совсем новая' })],
      },
      opts,
    );

    const expected = original.filter((_, i) => i !== 7);
    expected[1] = exp({ name: 'Новое имя' });
    expect(await table(output)).toEqual([...expected, exp({ name: 'Совсем новая' })]);
  });

  it('пустые правки не меняют таблицу', async () => {
    expect(await table(await applyEditsToBuffer(fixture, NONE, opts))).toEqual(original);
  });

  it('строки нет в Excel: ошибка ROW_NOT_FOUND, файл не возвращается', async () => {
    const missing = exp({ name: 'Такой строки нет' });

    for (const edits of [
      { ...NONE, removals: [missing] },
      { ...NONE, updates: [{ from: missing, to: exp() }] },
    ]) {
      await expect(applyEditsToBuffer(fixture, edits, opts)).rejects.toMatchObject({
        name: 'ExcelEditError',
        code: 'ROW_NOT_FOUND',
      });
    }
  });

  it('удалить строку нужно столько раз, сколько их есть: лишнее удаление это ошибка', async () => {
    await expect(
      applyEditsToBuffer(fixture, { ...NONE, removals: [original[0]!, original[0]!] }, opts),
    ).rejects.toBeInstanceOf(ExcelEditError);
  });

  it('исходный файл не меняется', async () => {
    const copy = Buffer.from(fixture);

    await applyEditsToBuffer(fixture, { ...NONE, removals: [original[0]!] }, opts);

    expect(fixture.equals(copy)).toBe(true);
  });
});

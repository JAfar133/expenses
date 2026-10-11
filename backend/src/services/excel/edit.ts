import JSZip from 'jszip';
import { appendExpensesToBuffer } from '../excel.service.ts';
import { locateTable } from './locate-table.ts';
import { readExcelTable } from './read.ts';
import { clearExpenseRow, writeExpenseRow } from './sheet-rows.ts';
import { assertTableIsSupported, readTableRange } from './table.ts';
import type { ExcelOptions, Expense } from './types.ts';

/** Что нужно сделать со строками таблицы за один проход. */
export interface RowEdits {
  /** Заменить строку: `from` — как она выглядит в Excel, `to` — как должна выглядеть */
  updates: { from: Expense; to: Expense }[];
  /** Убрать строки (как они выглядят в Excel) */
  removals: Expense[];
  /** Дописать в конец */
  appends: Expense[];
}

export type ExcelEditErrorCode = 'ROW_NOT_FOUND' | 'VERIFICATION_FAILED';

/** Строку не нашли или результат не совпал с ожидаемым: файл не загружается. */
export class ExcelEditError extends Error {
  constructor(
    readonly code: ExcelEditErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ExcelEditError';
  }
}

const keyOf = (e: Expense) => JSON.stringify([e.date, e.card, e.category, e.name, e.amount]);

/**
 * Применяет правки, удаления и добавления к таблице XLSX.
 *
 * Строки ищутся по содержимому (в Excel нет идентификаторов); одинаковые строки взаимозаменяемы.
 * Меняются только значения ячеек листа: стили, остальные части книги и номера строк остаются как были.
 * Удаление действует как «Удалить строку таблицы»: значения ниже сдвигаются вверх, последняя строка очищается.
 * Если ниже есть заполненные, но нечитаемые строки, их двигать нельзя: удаляемая строка просто очищается.
 *
 * Перед возвратом файл читается заново и сверяется с ожидаемым содержимым таблицы целиком.
 * При любом расхождении выбрасывается ошибка, и загружать нечего.
 */
export async function applyEditsToBuffer(
  source: Buffer,
  edits: RowEdits,
  options: ExcelOptions,
): Promise<Buffer> {
  const original = await readExcelTable(source, options);
  const invalid = new Set(original.invalidRows);

  // Номера строк листа: что в них лежит сейчас
  const model = new Map<number, Expense>(original.rows.map(({ row, expense }) => [row, expense]));
  const used = new Set<number>();
  const take = (expense: Expense): number => {
    const found = original.rows.find(
      ({ row, expense: e }) => !used.has(row) && keyOf(e) === keyOf(expense),
    );
    if (!found) {
      throw new ExcelEditError('ROW_NOT_FOUND', `Row not found in Excel: ${keyOf(expense)}`);
    }
    used.add(found.row);
    return found.row;
  };

  const updateRows = edits.updates.map((update) => ({ row: take(update.from), to: update.to }));
  const removalRows = edits.removals.map(take).sort((a, b) => b - a);

  const zip = await JSZip.loadAsync(source);
  const { sheetPath, tableXml, sheetXml: initialSheetXml } = await locateTable(zip, options);
  assertTableIsSupported(tableXml, readTableRange(tableXml).range);
  let sheetXml = initialSheetXml;

  for (const { row, to } of updateRows) {
    sheetXml = writeExpenseRow(sheetXml, row, row, to);
    model.set(row, to);
  }

  // Удаляем снизу вверх: сдвиг нижних строк не меняет номера тех, что выше
  for (const row of removalRows) {
    const lastFilled = Math.max(...model.keys(), ...invalid);
    const canShift = ![...invalid].some((invalidRow) => invalidRow > row);

    if (!canShift) {
      sheetXml = clearExpenseRow(sheetXml, row);
      model.delete(row);
      continue;
    }
    for (let current = row; current < lastFilled; current++) {
      const next = model.get(current + 1);
      if (next) {
        sheetXml = writeExpenseRow(sheetXml, current, current, next);
        model.set(current, next);
      } else {
        sheetXml = clearExpenseRow(sheetXml, current);
        model.delete(current);
      }
    }
    sheetXml = clearExpenseRow(sheetXml, lastFilled);
    model.delete(lastFilled);
  }

  zip.file(sheetPath, sheetXml);
  let output: Buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });

  if (edits.appends.length > 0) {
    output = (await appendExpensesToBuffer(output, edits.appends, options)).output;
  }

  await verify(
    output,
    expectedExpenses(original.rows, updateRows, removalRows, edits.appends),
    original.skippedCount,
    options,
  );
  return output;
}

/** Ожидаемое содержимое таблицы: прежние строки с заменами и удалениями (по тем же строкам, что нашли), затем добавленные. */
function expectedExpenses(
  rows: { row: number; expense: Expense }[],
  updateRows: { row: number; to: Expense }[],
  removalRows: number[],
  appends: Expense[],
): Expense[] {
  const replacement = new Map(updateRows.map(({ row, to }) => [row, to]));
  const removed = new Set(removalRows);

  return [
    ...rows
      .filter(({ row }) => !removed.has(row))
      .map(({ row, expense }) => replacement.get(row) ?? expense),
    ...appends,
  ];
}

async function verify(
  output: Buffer,
  expected: Expense[],
  expectedInvalid: number,
  options: ExcelOptions,
): Promise<void> {
  const actual = await readExcelTable(output, options);

  if (actual.skippedCount !== expectedInvalid) {
    throw new ExcelEditError('VERIFICATION_FAILED', 'Number of unreadable rows changed');
  }
  const same =
    actual.expenses.length === expected.length &&
    actual.expenses.every((expense, index) => keyOf(expense) === keyOf(expected[index]!));
  if (!same) {
    throw new ExcelEditError(
      'VERIFICATION_FAILED',
      'Table content differs from the expected result',
    );
  }
}

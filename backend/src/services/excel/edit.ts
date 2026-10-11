import JSZip from 'jszip';
import { appendExpensesToBuffer } from '../excel.service.ts';
import { locateTable } from './locate-table.ts';
import { readExcelTable } from './read.ts';
import { clearExpenseRow, writeExpenseRow } from './sheet-rows.ts';
import { assertTableIsSupported, readTableRange } from './table.ts';
import type { ExcelOptions, Expense } from './types.ts';

/** What needs to be done to the table rows in one pass. */
export interface RowEdits {
  /** Replace a row: `from` is how it looks in Excel, `to` is how it should look */
  updates: { from: Expense; to: Expense }[];
  /** Remove rows (as they look in Excel) */
  removals: Expense[];
  /** Append to the end */
  appends: Expense[];
}

export type ExcelEditErrorCode = 'ROW_NOT_FOUND' | 'VERIFICATION_FAILED';

/** The row was not found or the result did not match the expected one: the file is not uploaded. */
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
 * Applies edits, deletions and additions to the XLSX table.
 *
 * Rows are found by content (Excel has no identifiers); identical rows are interchangeable.
 * Only sheet cell values change: styles, the other parts of the workbook and row numbers stay as they were.
 * Deletion acts like «Удалить строку таблицы» ("Delete table row"): the values below shift up, the last row is cleared.
 * If there are filled but unreadable rows below, they must not be moved: the row being deleted is simply cleared.
 *
 * Before returning, the file is read again and checked against the expected content of the whole table.
 * On any mismatch an error is thrown and there is nothing to upload.
 */
export async function applyEditsToBuffer(
  source: Buffer,
  edits: RowEdits,
  options: ExcelOptions,
): Promise<Buffer> {
  const original = await readExcelTable(source, options);
  const invalid = new Set(original.invalidRows);

  // Sheet row numbers: what they hold right now
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

  // Delete from bottom to top: shifting lower rows does not change the numbers of those above
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

/** Expected table content: the previous rows with replacements and deletions (at the same rows that were found), then the added ones. */
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

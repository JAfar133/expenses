import { readFile, writeFile } from 'node:fs/promises';
import JSZip from 'jszip';
import { toExcelSerial } from './excel/dates.ts';
import { locateTable } from './excel/locate-table.ts';
import { ExcelStructureError } from './excel/errors.ts';
import { findLastFilledRow, rowHasData, writeExpenseRow } from './excel/sheet-rows.ts';
import { verifyAppendedExpense } from './excel/read.ts';
import { assertTableIsSupported, readTableRange, replaceTableRef } from './excel/table.ts';
import type { ExcelOptions, ExcelWriteResult, Expense } from './excel/types.ts';

export { readExcelExpenses } from './excel/read.ts';
export { toExcelSerial } from './excel/dates.ts';
export type { ExcelOptions, ExcelWriteResult, Expense } from './excel/types.ts';

/**
 * Appends an operation to the structured XLSX table.
 *
 * Only the sheet XML and the table XML are changed. The other parts of the workbook (charts, styles,
 * calcChain, metadata) stay untouched — ExcelJS loses them on re-save.
 *
 * @deprecated Since v2 the Excel report (`GET /api/expenses/export.xlsx`) replaces the two-way sync. This code is kept
 * for the installation that still works with its Excel file, can be switched off in the app (SyncSwitch) and is not
 * extended: new features (cards, currencies, access) do not go into it.
 */
export async function appendExpenseToBuffer(
  source: Buffer,
  expense: Expense,
  options: ExcelOptions,
): Promise<{ output: Buffer; result: ExcelWriteResult }> {
  validateExpense(expense);

  const zip = await JSZip.loadAsync(source);
  const { sheetPath, tablePath, sheetXml, tableXml } = await locateTable(zip, options);
  const { ref, range } = readTableRange(tableXml);
  assertTableIsSupported(tableXml, range);

  // the sheet's rowCount is not used: it includes empty formatted rows
  const lastFilledRow = findLastFilledRow(sheetXml, range.headerRow, range.lastRow);
  const targetRow = lastFilledRow + 1;
  const tableExtended = targetRow > range.lastRow;
  // Extending the table would overwrite whatever lies right below it: refuse instead of losing it
  if (tableExtended && rowHasData(sheetXml, targetRow)) {
    throw new ExcelStructureError(
      'TABLE_BLOCKED',
      `Row ${targetRow} below table ${options.tableName} is not empty`,
    );
  }
  const newRef = `A${range.headerRow}:E${tableExtended ? targetRow : range.lastRow}`;

  zip.file(sheetPath, writeExpenseRow(sheetXml, targetRow, lastFilledRow, expense));
  if (tableExtended) {
    zip.file(tablePath, replaceTableRef(tableXml, ref, newRef));
  }

  const output = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  const result = { row: targetRow, tableRef: newRef, tableExtended };
  await verifyAppendedExpense(output, options, result, expense);

  return { output, result };
}

/** Appends several operations in a row, each one is verified after the write. */
export async function appendExpensesToBuffer(
  source: Buffer,
  expenses: Expense[],
  options: ExcelOptions,
): Promise<{ output: Buffer; results: ExcelWriteResult[] }> {
  let output = source;
  const results: ExcelWriteResult[] = [];

  for (const expense of expenses) {
    const written = await appendExpenseToBuffer(output, expense, options);
    output = written.output;
    results.push(written.result);
  }
  return { output, results };
}

export async function appendExpense(
  filePath: string,
  expense: Expense,
  options: ExcelOptions,
  outputPath = filePath,
): Promise<ExcelWriteResult> {
  const { output, result } = await appendExpenseToBuffer(
    await readFile(filePath),
    expense,
    options,
  );
  await writeFile(outputPath, output);
  return result;
}

export function validateExpense(expense: Expense): void {
  toExcelSerial(expense.date);

  if (!Number.isSafeInteger(expense.amount) || expense.amount <= 0) {
    throw new Error('amount must be a positive integer');
  }

  for (const field of ['card', 'category', 'name'] as const) {
    if (!expense[field].trim()) {
      throw new Error(`${field} is empty`);
    }
  }
}

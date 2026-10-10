import { readFile, writeFile } from 'node:fs/promises';
import JSZip from 'jszip';
import { toExcelSerial } from './excel/dates.ts';
import { locateTable } from './excel/locate-table.ts';
import { findLastFilledRow, writeExpenseRow } from './excel/sheet-rows.ts';
import { verifyAppendedExpense } from './excel/read.ts';
import { assertTableIsSupported, readTableRange, replaceTableRef } from './excel/table.ts';
import type { ExcelOptions, ExcelWriteResult, Expense } from './excel/types.ts';

export { readCategories } from './excel/read.ts';
export { toExcelSerial } from './excel/dates.ts';
export type { ExcelOptions, ExcelWriteResult, Expense } from './excel/types.ts';

/**
 * Добавляет операцию в структурированную таблицу XLSX.
 *
 * Меняются только XML листа и XML таблицы. Остальные части книги (графики, стили,
 * calcChain, metadata) остаются нетронутыми — ExcelJS при пересохранении их теряет.
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

  // rowCount листа не используется: он включает пустые отформатированные строки
  const lastFilledRow = findLastFilledRow(sheetXml, range.headerRow, range.lastRow);
  const targetRow = lastFilledRow + 1;
  const tableExtended = targetRow > range.lastRow;
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

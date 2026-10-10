import JSZip from 'jszip';
import { loadWorkbook } from './exceljs.ts';
import { locateTable } from './locate-table.ts';
import { readTableRange } from './table.ts';
import type { ExcelOptions, ExcelWriteResult, Expense } from './types.ts';

/** Уникальные категории из заполненных строк таблицы в порядке первого появления. */
export async function readCategories(source: Uint8Array, options: ExcelOptions): Promise<string[]> {
  const { range } = await readRange(source, options);
  const sheet = (await loadWorkbook(source)).getWorksheet(options.sheetName);
  const categories = new Set<string>();

  for (let row = range.headerRow + 1; row <= range.lastRow; row++) {
    const value = sheet?.getRow(row).getCell(3).value;
    if (typeof value === 'string' && value.trim()) {
      categories.add(value.trim());
    }
  }

  return [...categories];
}

/** Повторно открывает записанный файл и убеждается, что операция лежит внутри таблицы. */
export async function verifyAppendedExpense(
  output: Uint8Array,
  options: ExcelOptions,
  result: ExcelWriteResult,
  expense: Expense,
): Promise<void> {
  const { range } = await readRange(output, options);
  if (result.row <= range.headerRow || result.row > range.lastRow) {
    throw new Error(`Row ${result.row} is outside of table ${options.tableName}`);
  }

  const sheet = (await loadWorkbook(output)).getWorksheet(options.sheetName);
  const cells = [1, 2, 3, 4, 5].map((column) => sheet?.getRow(result.row).getCell(column).value);
  const [date, card, category, name, amount] = cells;

  const matches =
    date instanceof Date &&
    date.toISOString().slice(0, 10) === expense.date &&
    card === expense.card &&
    category === expense.category &&
    name === expense.name &&
    amount === expense.amount;

  if (!matches) {
    throw new Error(`Written row ${result.row} does not match the expense`);
  }
}

async function readRange(source: Uint8Array, options: ExcelOptions) {
  const zip = await JSZip.loadAsync(source);
  const { tableXml } = await locateTable(zip, options);
  return readTableRange(tableXml);
}

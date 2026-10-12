import type { CellValue } from 'exceljs';
import JSZip from 'jszip';
import { fromExcelSerial } from './dates.ts';
import { loadWorkbook } from './exceljs.ts';
import { locateTable } from './locate-table.ts';
import { assertTableIsSupported, readTableRange } from './table.ts';
import type { ExcelOptions, ExcelWriteResult, Expense } from './types.ts';

const MAX_NAME_LENGTH = 255;
/** How many descriptions of skipped rows we return (so the response does not grow). */
const MAX_REPORTED_SKIPS = 20;

export interface SkippedRow {
  row: number;
  reason: string;
}

export interface ExcelExpenses {
  /** Valid operations in table row order */
  expenses: Expense[];
  /** How many filled rows cannot be imported (invalid values) */
  skippedCount: number;
  skipped: SkippedRow[];
}

/** A valid table row with its sheet number. */
export interface TableRow {
  row: number;
  expense: Expense;
}

export interface ExcelTable extends ExcelExpenses {
  /** Valid rows with sheet numbers, in row order */
  rows: TableRow[];
  /** Numbers of all filled but invalid rows (`skipped` describes at most 20) */
  invalidRows: number[];
}

/**
 * Reads all operations from the structured table together with row numbers. Empty rows are ignored,
 * while partially filled or invalid ones are skipped and listed in `skipped`.
 *
 * @deprecated Since v2 the Excel report (`GET /api/expenses/export.xlsx`) replaces the two-way sync. This code is kept
 * for the installation that still works with its Excel file, can be switched off in the app (SyncSwitch) and is not
 * extended: new features (cards, currencies, access) do not go into it.
 */
export async function readExcelTable(
  source: Uint8Array,
  options: ExcelOptions,
): Promise<ExcelTable> {
  const { range, tableXml } = await readRange(source, options);
  // The structure is checked before anything is read: a changed table must not turn into "rows vanished"
  assertTableIsSupported(tableXml, range);
  const sheet = (await loadWorkbook(source)).getWorksheet(options.sheetName);
  const table: ExcelTable = {
    expenses: [],
    skippedCount: 0,
    skipped: [],
    rows: [],
    invalidRows: [],
  };

  for (let rowNumber = range.headerRow + 1; rowNumber <= range.lastRow; rowNumber++) {
    const row = sheet?.getRow(rowNumber);
    const cells = [1, 2, 3, 4, 5].map((column) => row?.getCell(column).value ?? null);
    if (cells.every(isEmptyCell)) continue;

    const parsed = parseRow(cells);
    if (typeof parsed === 'string') {
      table.skippedCount++;
      table.invalidRows.push(rowNumber);
      if (table.skipped.length < MAX_REPORTED_SKIPS) {
        table.skipped.push({ row: rowNumber, reason: parsed });
      }
    } else {
      table.expenses.push(parsed);
      table.rows.push({ row: rowNumber, expense: parsed });
    }
  }

  return table;
}

/** Reads all operations from the table (without row numbers). */
export async function readExcelExpenses(
  source: Uint8Array,
  options: ExcelOptions,
): Promise<ExcelExpenses> {
  const { expenses, skippedCount, skipped } = await readExcelTable(source, options);
  return { expenses, skippedCount, skipped };
}

function parseRow([date, card, category, name, amount]: CellValue[]): Expense | string {
  const isoDate = toIsoDate(date);
  if (!isoDate) return 'некорректная дата';

  const cardText = toText(card);
  if (!cardText) return 'не указана карта';

  const categoryText = toText(category);
  if (!categoryText) return 'не указана категория';

  const nameText = toText(name);
  if (!nameText) return 'не указано наименование';
  if (nameText.length > MAX_NAME_LENGTH) return 'слишком длинное наименование';

  const amountValue = toNumber(amount);
  if (amountValue === null || !Number.isSafeInteger(amountValue) || amountValue <= 0) {
    return 'стоимость должна быть положительным целым числом';
  }

  return {
    date: isoDate,
    card: cardText,
    category: categoryText,
    name: nameText,
    amount: amountValue,
  };
}

const isEmptyCell = (value: CellValue) =>
  value === null || value === undefined || (typeof value === 'string' && value.trim() === '');

/** Cell value: formulas are replaced by their result, rich text by a concatenated string. */
function unwrap(value: CellValue): CellValue {
  if (value && typeof value === 'object' && 'result' in value) {
    return (value.result ?? null) as CellValue;
  }
  return value;
}

function toText(value: CellValue): string | null {
  const cell = unwrap(value);
  if (typeof cell === 'string') return cell.trim() || null;
  if (typeof cell === 'number') return String(cell);
  if (cell && typeof cell === 'object' && 'richText' in cell) {
    return (
      cell.richText
        .map((part) => part.text)
        .join('')
        .trim() || null
    );
  }
  return null;
}

function toNumber(value: CellValue): number | null {
  const cell = unwrap(value);
  return typeof cell === 'number' ? cell : null;
}

/** Dates in Excel are real dates (Date in UTC) or numbers if the cell has no date format. */
function toIsoDate(value: CellValue): string | null {
  const cell = unwrap(value);
  if (cell instanceof Date && !Number.isNaN(cell.getTime())) {
    return cell.toISOString().slice(0, 10);
  }
  if (typeof cell === 'number' && cell >= 1 && cell < 2_958_466) {
    return fromExcelSerial(cell);
  }
  return null;
}

/** Reopens the written file and makes sure the operation is inside the table. */
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
  return { ...readTableRange(tableXml), tableXml };
}

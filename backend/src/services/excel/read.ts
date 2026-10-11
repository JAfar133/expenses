import type { CellValue } from 'exceljs';
import JSZip from 'jszip';
import { fromExcelSerial } from './dates.ts';
import { loadWorkbook } from './exceljs.ts';
import { locateTable } from './locate-table.ts';
import { readTableRange } from './table.ts';
import type { ExcelOptions, ExcelWriteResult, Expense } from './types.ts';

const MAX_NAME_LENGTH = 255;
/** Сколько описаний пропущенных строк возвращаем (чтобы ответ не разрастался). */
const MAX_REPORTED_SKIPS = 20;

export interface SkippedRow {
  row: number;
  reason: string;
}

export interface ExcelExpenses {
  /** Корректные операции в порядке строк таблицы */
  expenses: Expense[];
  /** Сколько заполненных строк нельзя импортировать (некорректные значения) */
  skippedCount: number;
  skipped: SkippedRow[];
}

/** Корректная строка таблицы с её номером на листе. */
export interface TableRow {
  row: number;
  expense: Expense;
}

export interface ExcelTable extends ExcelExpenses {
  /** Корректные строки с номерами листа, в порядке строк */
  rows: TableRow[];
  /** Номера всех заполненных, но некорректных строк (в `skipped` описаны не больше 20) */
  invalidRows: number[];
}

/**
 * Читает все операции из структурированной таблицы вместе с номерами строк. Пустые строки игнорируются,
 * а частично заполненные или некорректные пропускаются и перечисляются в `skipped`.
 */
export async function readExcelTable(
  source: Uint8Array,
  options: ExcelOptions,
): Promise<ExcelTable> {
  const { range } = await readRange(source, options);
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

/** Читает все операции из таблицы (без номеров строк). */
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

/** Значение ячейки: формулы заменяются результатом, форматированный текст — склеенной строкой. */
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

/** Даты в Excel — настоящие даты (Date в UTC) или числа, если у ячейки нет формата даты. */
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

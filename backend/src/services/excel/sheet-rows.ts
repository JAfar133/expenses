import { COLUMNS, type Column, type Expense } from './types.ts';
import { toExcelSerial } from './dates.ts';
import { escapeXml } from './xml.ts';

/** Finds the sheet row XML (`<row r="N">…</row>` or `<row r="N" …/>`). */
function findRow(sheetXml: string, rowNumber: number): string | undefined {
  return new RegExp(`<row r="${rowNumber}"(?:[^>]*/>|[^>]*>.*?</row>)`, 's').exec(sheetXml)?.[0];
}

function findCell(rowXml: string, column: Column, rowNumber: number): RegExpExecArray | null {
  return new RegExp(`<c r="${column}${rowNumber}"([^>]*?)(?:/>|>.*?</c>)`, 's').exec(rowXml);
}

function getStyle(cellAttributes: string): string {
  return /\bs="(\d+)"/.exec(cellAttributes)?.[1] ?? '';
}

function isRowEmpty(rowXml: string, rowNumber: number): boolean {
  return COLUMNS.every((column) => {
    const cell = findCell(rowXml, column, rowNumber);
    return !cell || !/<(v|is)\b/.test(cell[0]);
  });
}

/**
 * Number of the last row with data in the range (firstRow, lastRow].
 * Empty formatted rows do not count as filled.
 */
export function findLastFilledRow(sheetXml: string, firstRow: number, lastRow: number): number {
  let lastFilled = firstRow;

  for (let row = firstRow + 1; row <= lastRow; row++) {
    const rowXml = findRow(sheetXml, row);
    if (rowXml && !isRowEmpty(rowXml, row)) {
      lastFilled = row;
    }
  }

  return lastFilled;
}

/**
 * Writes an operation into row `targetRow`. Cell styles are taken from the row itself,
 * and if it has no cell there, from row `styleSourceRow`.
 */
export function writeExpenseRow(
  sheetXml: string,
  targetRow: number,
  styleSourceRow: number,
  expense: Expense,
): string {
  const existingRow = findRow(sheetXml, targetRow);

  if (!existingRow) {
    const cells = COLUMNS.map((column) =>
      buildCell(column, targetRow, readStyle(sheetXml, styleSourceRow, column), expense),
    );
    return insertRow(sheetXml, targetRow, `<row r="${targetRow}">${cells.join('')}</row>`);
  }

  let rowXml = existingRow.endsWith('/>') ? existingRow.replace(/\/>$/, '></row>') : existingRow;

  for (const column of COLUMNS) {
    const existingCell = findCell(rowXml, column, targetRow);
    const style = existingCell
      ? getStyle(existingCell[1]!)
      : readStyle(sheetXml, styleSourceRow, column);
    const cellXml = buildCell(column, targetRow, style, expense);

    rowXml = existingCell
      ? rowXml.replace(existingCell[0], () => cellXml)
      : insertCell(rowXml, targetRow, cellXml);
  }

  return sheetXml.replace(existingRow, () => rowXml);
}

/**
 * Clears the A:E values in a row, leaving the styled cells: the row stays inside the table, empty.
 * Rows or cells that do not exist are left alone.
 */
export function clearExpenseRow(sheetXml: string, rowNumber: number): string {
  const existingRow = findRow(sheetXml, rowNumber);
  if (!existingRow || existingRow.endsWith('/>')) return sheetXml;

  let rowXml = existingRow;
  for (const column of COLUMNS) {
    const cell = findCell(rowXml, column, rowNumber);
    if (!cell) continue;
    const style = getStyle(cell[1]!);
    const empty = `<c r="${column}${rowNumber}"${style ? ` s="${style}"` : ''}/>`;
    rowXml = rowXml.replace(cell[0], () => empty);
  }
  return sheetXml.replace(existingRow, () => rowXml);
}

function readStyle(sheetXml: string, rowNumber: number, column: Column): string {
  const rowXml = findRow(sheetXml, rowNumber);
  const cell = rowXml && findCell(rowXml, column, rowNumber);
  return cell ? getStyle(cell[1]!) : '';
}

/** Rows in sheetData must go in ascending number order. */
function insertRow(sheetXml: string, rowNumber: number, rowXml: string): string {
  const nextRow = [...sheetXml.matchAll(/<row r="(\d+)"/g)].find(
    (match) => Number(match[1]) > rowNumber,
  );

  if (!nextRow) {
    return sheetXml.replace('</sheetData>', `${rowXml}</sheetData>`);
  }
  return sheetXml.slice(0, nextRow.index) + rowXml + sheetXml.slice(nextRow.index);
}

/** Cells in a row must go in column order: we insert before the first cell to the right of E. */
function insertCell(rowXml: string, rowNumber: number, cellXml: string): string {
  const rightCell = new RegExp(`<c r="[F-Z]${rowNumber}"`).exec(rowXml);

  if (!rightCell) {
    return rowXml.replace('</row>', `${cellXml}</row>`);
  }
  return rowXml.slice(0, rightCell.index) + cellXml + rowXml.slice(rightCell.index);
}

function buildCell(column: Column, row: number, style: string, expense: Expense): string {
  const ref = `${column}${row}`;
  const styleAttr = style ? ` s="${style}"` : '';

  switch (column) {
    case 'A':
      return `<c r="${ref}"${styleAttr}><v>${toExcelSerial(expense.date)}</v></c>`;
    case 'E':
      return `<c r="${ref}"${styleAttr}><v>${expense.amount}</v></c>`;
    default:
      return buildTextCell(
        ref,
        styleAttr,
        { B: expense.card, C: expense.category, D: expense.name }[column],
      );
  }
}

/** An inline string always stays text and is never evaluated as a formula. */
function buildTextCell(ref: string, styleAttr: string, text: string): string {
  const escaped = escapeXml(text);
  return `<c r="${ref}"${styleAttr} t="inlineStr"><is><t xml:space="preserve">${escaped}</t></is></c>`;
}

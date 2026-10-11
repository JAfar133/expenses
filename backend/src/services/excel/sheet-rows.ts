import { COLUMNS, type Column, type Expense } from './types.ts';
import { toExcelSerial } from './dates.ts';
import { escapeXml } from './xml.ts';

/** Находит XML строки листа (`<row r="N">…</row>` или `<row r="N" …/>`). */
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
 * Номер последней строки с данными в диапазоне (firstRow, lastRow].
 * Пустые отформатированные строки не считаются заполненными.
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
 * Записывает операцию в строку `targetRow`. Стили ячеек берутся из самой строки,
 * а если там ячейки нет — из строки `styleSourceRow`.
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
 * Очищает значения A:E в строке, оставляя ячейки со стилями: строка остаётся внутри таблицы пустой.
 * Строки или ячейки, которых нет, не трогаются.
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

/** Строки в sheetData должны идти по возрастанию номера. */
function insertRow(sheetXml: string, rowNumber: number, rowXml: string): string {
  const nextRow = [...sheetXml.matchAll(/<row r="(\d+)"/g)].find(
    (match) => Number(match[1]) > rowNumber,
  );

  if (!nextRow) {
    return sheetXml.replace('</sheetData>', `${rowXml}</sheetData>`);
  }
  return sheetXml.slice(0, nextRow.index) + rowXml + sheetXml.slice(nextRow.index);
}

/** Ячейки в строке должны идти по порядку столбцов: вставляем перед первой ячейкой правее E. */
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

/** Inline-строка всегда остаётся текстом и никогда не вычисляется как формула. */
function buildTextCell(ref: string, styleAttr: string, text: string): string {
  const escaped = escapeXml(text);
  return `<c r="${ref}"${styleAttr} t="inlineStr"><is><t xml:space="preserve">${escaped}</t></is></c>`;
}

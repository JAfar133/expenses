export interface Expense {
  /** Date in YYYY-MM-DD format */
  date: string;
  card: string;
  category: string;
  name: string;
  amount: number;
}

export interface ExcelOptions {
  sheetName: string;
  tableName: string;
}

export interface ExcelWriteResult {
  /** Number of the sheet row the operation was written to */
  row: number;
  /** Table range after the write */
  tableRef: string;
  tableExtended: boolean;
}

/** Columns of the «Операции» (Operations) table in order. */
export const COLUMNS = ['A', 'B', 'C', 'D', 'E'] as const;
export type Column = (typeof COLUMNS)[number];

export const TABLE_HEADERS = ['дата', 'карта', 'категория', 'наименование', 'стоимость'];

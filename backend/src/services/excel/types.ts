export interface Expense {
  /** Дата в формате YYYY-MM-DD */
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
  /** Номер строки листа, в которую записана операция */
  row: number;
  /** Диапазон таблицы после записи */
  tableRef: string;
  tableExtended: boolean;
}

/** Столбцы таблицы «Операции» в порядке следования. */
export const COLUMNS = ['A', 'B', 'C', 'D', 'E'] as const;
export type Column = (typeof COLUMNS)[number];

export const TABLE_HEADERS = ['дата', 'карта', 'категория', 'наименование', 'стоимость'];

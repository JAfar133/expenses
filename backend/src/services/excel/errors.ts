export type ExcelStructureErrorCode = 'TABLE_UNSUPPORTED' | 'TABLE_BLOCKED';

/**
 * The workbook does not look the way the app expects (changed table, data right below it).
 * Nothing is written and nothing in the database changes until the file is fixed.
 */
export class ExcelStructureError extends Error {
  constructor(
    readonly code: ExcelStructureErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ExcelStructureError';
  }
}

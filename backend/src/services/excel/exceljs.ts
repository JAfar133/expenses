import ExcelJS from 'exceljs';

/** ExcelJS используется только для чтения; типы библиотеки объявляют устаревший Buffer. */
export async function loadWorkbook(source: Uint8Array): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(source as unknown as ExcelJS.Buffer);
  return workbook;
}

import ExcelJS from 'exceljs';

/** ExcelJS is used for reading only; the library types declare an outdated Buffer. */
export async function loadWorkbook(source: Uint8Array): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(source as unknown as ExcelJS.Buffer);
  return workbook;
}

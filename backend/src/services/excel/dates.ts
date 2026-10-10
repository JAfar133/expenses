const MS_PER_DAY = 86_400_000;
/** Начало отсчёта дат Excel (с учётом ошибки високосного 1900 года). */
const EXCEL_EPOCH_UTC = Date.UTC(1899, 11, 30);

/**
 * Переводит ISO-дату (YYYY-MM-DD) в серийный номер даты Excel.
 * Расчёт ведётся в UTC и не зависит от часового пояса сервера.
 */
export function toExcelSerial(isoDate: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) {
    throw new Error(`Invalid ISO date: ${isoDate}`);
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const timestamp = Date.UTC(year, month - 1, day);

  // Date.UTC молча переносит 30 февраля на март, поэтому сверяем день
  if (new Date(timestamp).getUTCDate() !== day) {
    throw new Error(`Invalid ISO date: ${isoDate}`);
  }

  return Math.round((timestamp - EXCEL_EPOCH_UTC) / MS_PER_DAY);
}

/** Обратное преобразование: серийный номер даты Excel в ISO-дату (YYYY-MM-DD). */
export function fromExcelSerial(serial: number): string {
  return new Date(EXCEL_EPOCH_UTC + Math.floor(serial) * MS_PER_DAY).toISOString().slice(0, 10);
}

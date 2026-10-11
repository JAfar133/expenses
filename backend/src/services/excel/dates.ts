const MS_PER_DAY = 86_400_000;
/** Start of the Excel date count (accounting for the 1900 leap year bug). */
const EXCEL_EPOCH_UTC = Date.UTC(1899, 11, 30);

/**
 * Converts an ISO date (YYYY-MM-DD) to an Excel date serial number.
 * The calculation is done in UTC and does not depend on the server time zone.
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

  // Date.UTC silently rolls February 30 over to March, so we check the day
  if (new Date(timestamp).getUTCDate() !== day) {
    throw new Error(`Invalid ISO date: ${isoDate}`);
  }

  return Math.round((timestamp - EXCEL_EPOCH_UTC) / MS_PER_DAY);
}

/** Inverse conversion: an Excel date serial number to an ISO date (YYYY-MM-DD). */
export function fromExcelSerial(serial: number): string {
  return new Date(EXCEL_EPOCH_UTC + Math.floor(serial) * MS_PER_DAY).toISOString().slice(0, 10);
}

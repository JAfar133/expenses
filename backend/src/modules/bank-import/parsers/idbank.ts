import { parseAmount } from '../money-text.ts';
import type { NotificationParser, ParsedNotification } from './parser.types.ts';

/** Armenia has no daylight saving time: the bank's local time is always UTC+4. */
const BANK_UTC_OFFSET_HOURS = 4;

/** «IDBank: GNUM» is a card purchase; other titles are other kinds of operations. */
const PURCHASE_TYPE = 'GNUM';

const AMOUNT_LINE = /^(\d[\d\s.,]*)\s+([A-Za-z]{3})$/;
const CARD_LINE = /^[A-Za-z][\w ]*?\s+\*+\s*(\d{4})\s*-\s*[^:]*:\s*\d[\d\s.,]*\s+[A-Za-z]{3}$/;
const PLACE_LINE = /^(.+),\s*[A-Za-z]{2}\s+(\d{2})\.(\d{2})\.(\d{4})\s+(\d{1,2}):(\d{2})$/;

/**
 * IDBank purchase:
 *   IDBank: GNUM
 *   1,540.00 AMD
 *   VISA **5386 - MNACORD: 3,238.96 AMD     (the card and the balance: the balance is not the purchase)
 *   URARTU ZAQYAN, AM 16.10.2026 20:40
 * Lines are recognised by their shape, not by position, so a notification whose first line repeats the title still reads.
 */
export const idbankParser: NotificationParser = {
  source: 'idbank',

  parse({ title, body }): ParsedNotification {
    const lines = body
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    const type = noticeType(title, lines);
    if (type !== PURCHASE_TYPE) return { kind: 'unsupported' };

    const amountLine = lines.map((line) => AMOUNT_LINE.exec(line)).find(Boolean);
    const cardLine = lines.map((line) => CARD_LINE.exec(line)).find(Boolean);
    const placeLine = lines.map((line) => PLACE_LINE.exec(line)).find(Boolean);
    if (!amountLine || !cardLine || !placeLine) {
      return { kind: 'error', reason: 'Не найдены сумма, карта или место и время операции' };
    }

    const amount = parseAmount(amountLine[1]!);
    if (amount === undefined || amount <= 0) {
      return { kind: 'error', reason: 'Не удалось прочитать сумму' };
    }
    const [, merchant, day, month, year, hour, minute] = placeLine;
    const occurredAt = bankMoment(+year!, +month!, +day!, +hour!, +minute!);
    if (!occurredAt) return { kind: 'error', reason: 'Не удалось прочитать дату' };

    return {
      kind: 'expense',
      purchase: {
        amount,
        currency: amountLine[2]!.toUpperCase(),
        merchant: merchant!.trim().replace(/\s+/g, ' '),
        cardLast4: cardLine[1]!,
        occurredAt,
        localDate: `${year}-${month}-${day}`,
      },
    };
  },
};

/** The kind of the operation: the word after «IDBank:» in the title, or in the first line of the text. */
function noticeType(title: string, lines: string[]): string | undefined {
  for (const text of [title, lines[0] ?? '']) {
    const match = /IDBank\s*:\s*([A-Za-z0-9_]+)/i.exec(text);
    if (match) return match[1]!.toUpperCase();
  }
  return undefined;
}

/** A moment from the bank's local date and time, or undefined for an impossible one. */
function bankMoment(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): Date | undefined {
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return undefined;
  const moment = new Date(Date.UTC(year, month - 1, day, hour - BANK_UTC_OFFSET_HOURS, minute));
  const local = new Date(moment.getTime() + BANK_UTC_OFFSET_HOURS * 3_600_000);
  return local.getUTCDate() === day && local.getUTCMonth() === month - 1 ? moment : undefined;
}

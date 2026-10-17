import { parseAmount } from '../money-text.ts';
import type { NotificationParser, ParsedNotification } from './parser.types.ts';

/** Armenia has no daylight saving time: the bank's local time is always UTC+4. */
const BANK_UTC_OFFSET_HOURS = 4;

/** «IDBank: GNUM» is a card purchase; other titles are other kinds of operations. */
const PURCHASE_TYPE = 'GNUM';

const AMOUNT_LINE = /^(\d[\d\s.,]*)\s+([A-Za-z]{3})$/;
/** Push: «VISA **5386 - MNACORD: 3,238.96 AMD» (the card, then the account and its balance) */
const CARD_LINE = /^[A-Za-z][\w ]*?\s+\*+\s*(\d{4})\s*-\s*[^:]*:\s*\d[\d\s.,]*\s+[A-Za-z]{3}$/;
/** SMS: «4703***7181,» (the first and the last four digits of the card) */
const MASKED_CARD_LINE = /^\d{4}\s*\*+\s*(\d{4})\s*,?$/;
/** Push: the shop, the country and the time on one line */
const PLACE_LINE = /^(.+),\s*[A-Za-z]{2}\s+(\d{2})\.(\d{2})\.(\d{4})\s+(\d{1,2}):(\d{2})$/;
/** SMS: the shop and the country on one line, the time on the next */
const SHOP_LINE = /^(.+?),?\s*,\s*[A-Za-z]{2}$|^(.+),\s*[A-Za-z]{2}$/;
const TIME_LINE = /^(\d{2})\.(\d{2})\.(\d{4})\s+(\d{1,2}):(\d{2})$/;

/**
 * IDBank purchase, in the two shapes the bank sends it.
 * Push notification:
 *   IDBank: GNUM
 *   1,540.00 AMD
 *   VISA **5386 - MNACORD: 3,238.96 AMD     (the card and the balance: the balance is not the purchase)
 *   URARTU ZAQYAN, AM 16.10.2026 20:40
 * SMS:
 *   GNUM
 *   5,632.00 AMD
 *   4703***7181,
 *   YEREVAN CITY AVAN ARINJ, AM
 *   17.10.2026 19:40
 *   MNACORD: 94,218.04 AMD
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
    const last4 = cardDigits(lines);
    const place = placeOf(lines);
    if (!amountLine || !last4 || !place) {
      return { kind: 'error', reason: 'Не найдены сумма, карта или место и время операции' };
    }

    const amount = parseAmount(amountLine[1]!);
    if (amount === undefined || amount <= 0) {
      return { kind: 'error', reason: 'Не удалось прочитать сумму' };
    }
    const { merchant, day, month, year, hour, minute } = place;
    const occurredAt = bankMoment(+year, +month, +day, +hour, +minute);
    if (!occurredAt) return { kind: 'error', reason: 'Не удалось прочитать дату' };

    return {
      kind: 'expense',
      purchase: {
        amount,
        currency: amountLine[2]!.toUpperCase(),
        merchant: merchant.trim().replace(/\s+/g, ' '),
        cardLast4: last4,
        occurredAt,
        localDate: `${year}-${month}-${day}`,
      },
    };
  },
};

/** The last four digits of the card, from either shape of the card line. */
function cardDigits(lines: string[]): string | undefined {
  for (const line of lines) {
    const match = CARD_LINE.exec(line) ?? MASKED_CARD_LINE.exec(line);
    if (match) return match[1];
  }
  return undefined;
}

interface Place {
  merchant: string;
  day: string;
  month: string;
  year: string;
  hour: string;
  minute: string;
}

/** The shop and the time: on one line (push) or on two lines, the shop first (SMS). */
function placeOf(lines: string[]): Place | undefined {
  for (const line of lines) {
    const one = PLACE_LINE.exec(line);
    if (one) {
      const [, merchant, day, month, year, hour, minute] = one;
      return {
        merchant: merchant!,
        day: day!,
        month: month!,
        year: year!,
        hour: hour!,
        minute: minute!,
      };
    }
  }
  const timeAt = lines.findIndex((line) => TIME_LINE.test(line));
  if (timeAt <= 0) return undefined;
  const [, day, month, year, hour, minute] = TIME_LINE.exec(lines[timeAt]!)!;
  const shop = SHOP_LINE.exec(lines[timeAt - 1]!);
  const merchant = shop?.[1] ?? shop?.[2];
  if (!merchant) return undefined;
  return { merchant, day: day!, month: month!, year: year!, hour: hour!, minute: minute! };
}

/**
 * The kind of the operation: the word after «IDBank:» in the title or in the first line (push), or the first line
 * on its own (SMS: «GNUM»).
 */
function noticeType(title: string, lines: string[]): string | undefined {
  for (const text of [title, lines[0] ?? '']) {
    const match = /IDBank\s*:\s*([A-Za-z0-9_]+)/i.exec(text);
    if (match) return match[1]!.toUpperCase();
  }
  const first = lines[0] ?? '';
  return /^[A-Za-z]{3,6}$/.test(first) ? first.toUpperCase() : undefined;
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

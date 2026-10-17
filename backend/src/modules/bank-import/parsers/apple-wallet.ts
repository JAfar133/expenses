import { readMoney, type MoneyText } from '../money-text.ts';
import type { NotificationInput, NotificationParser, ParsedNotification } from './parser.types.ts';

/** A text field of the request: strings as they are, numbers as text, everything else is not text. */
export function textField(fields: Record<string, unknown>, name: string): string | undefined {
  const value = fields[name];
  if (typeof value === 'string') return value.trim() || undefined;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
}

/** The time field as people spell it in Shortcuts («recivedAt» is a common typo) */
const RECEIVED_AT_NAMES = ['receivedAt', 'received_at', 'recivedAt', 'recived_at'];

/** The first of several field names that holds text. */
function firstText(fields: Record<string, unknown>, names: string[]): string | undefined {
  for (const name of names) {
    const value = textField(fields, name);
    if (value) return value;
  }
  return undefined;
}

const CURRENCY_CODE = /^[A-Za-z]{3}$/;

/**
 * Apple Wallet (the «Transaction» automation of iOS Shortcuts). What Shortcuts really passes is not known in
 * advance, so every field is optional and the same fact is looked for in several places:
 *   merchant: `merchant`, then `name`, then `title`, then the text before the amount in `body`/`transaction`;
 *   amount:   `amount`, then `transaction`, then `body`; the currency: `currency`, then next to the amount;
 *   card:     `cardLast4` (digits) as digits; `card` only as a hint (the Wallet name of the card is not its number);
 *   time:     `receivedAt`, else the moment the server got the request.
 * No amount or no currency: nothing is created (the request stays in the log).
 */
export const appleWalletParser: NotificationParser = {
  source: 'apple_wallet',

  parse(input: NotificationInput): ParsedNotification {
    const { fields, title, body } = input;
    const transaction = textField(fields, 'transaction');

    const money = findMoney(fields, [textField(fields, 'amount'), transaction, body, title]);
    if (!money) return { kind: 'error', reason: 'Не найдена сумма операции' };
    if (money.amount <= 0) return { kind: 'error', reason: 'Сумма операции не больше нуля' };
    const currency = currencyOf(fields, money, [transaction, body, title]);
    if (!currency) return { kind: 'error', reason: 'Не найдена валюта операции' };

    const merchant = merchantOf(fields, [transaction, body], title);
    if (!merchant) return { kind: 'error', reason: 'Не найден продавец' };

    const occurred = momentOf(firstText(fields, RECEIVED_AT_NAMES), input);
    const last4 = lastFour(textField(fields, 'cardLast4'));
    return {
      kind: 'expense',
      purchase: {
        amount: money.amount,
        currency,
        merchant: merchant.slice(0, 255),
        ...(last4 ? { cardLast4: last4 } : {}),
        ...(textField(fields, 'card') ? { cardHint: textField(fields, 'card')! } : {}),
        ...(textField(fields, 'category') ? { categoryHint: textField(fields, 'category')! } : {}),
        ...(textField(fields, 'transactionId')
          ? { transactionId: textField(fields, 'transactionId')! }
          : {}),
        occurredAt: occurred.at,
        localDate: occurred.localDate,
      },
    };
  },
};

/** The first candidate text with an amount in it. */
function findMoney(
  _fields: Record<string, unknown>,
  candidates: (string | undefined)[],
): MoneyText | undefined {
  for (const text of candidates) {
    const money = text ? readMoney(text) : undefined;
    if (money) return money;
  }
  return undefined;
}

/** `currency` if the request gives one, else the one next to the amount, else the one in another text. */
function currencyOf(
  fields: Record<string, unknown>,
  money: MoneyText,
  others: (string | undefined)[],
): string | undefined {
  const given = textField(fields, 'currency');
  if (given && CURRENCY_CODE.test(given)) return given.toUpperCase();
  if (money.currency) return money.currency;
  for (const text of others) {
    const found = text ? readMoney(text)?.currency : undefined;
    if (found) return found;
  }
  return undefined;
}

/** The shop: `merchant`, `name`, `title`, else the words in front of the amount («Shop — 1950 AMD»). */
function merchantOf(
  fields: Record<string, unknown>,
  texts: (string | undefined)[],
  title: string,
): string | undefined {
  const direct =
    textField(fields, 'merchant') ?? textField(fields, 'name') ?? (title.trim() || undefined);
  if (direct) return clean(direct);
  for (const text of texts) {
    const before = text?.split(/\s[—–-]\s|,\s*(?=[-\d$€₽֏]|[A-Z]{3}\b)/)[0];
    if (before && !readMoney(before)) return clean(before);
  }
  return undefined;
}

const clean = (text: string): string => text.replace(/\s+/g, ' ').trim();

/** The last four digits out of what was passed as `cardLast4` (digits only; fewer than four: nothing). */
function lastFour(text: string | undefined): string | undefined {
  const digits = text?.replace(/\D/g, '') ?? '';
  return digits.length >= 4 ? digits.slice(-4) : undefined;
}

/**
 * When it happened: `receivedAt` if it reads as a time, else now. An ISO time with an offset names the date where it
 * happened; a time written the way the phone shows it («17 окт. 2026 г., 15:26», «17.10.2026 15:26») has no zone and
 * is read in the person's time zone.
 */
function momentOf(
  text: string | undefined,
  input: NotificationInput,
): { at: Date; localDate: string } {
  const iso = text ? new Date(text) : undefined;
  if (text && iso && !Number.isNaN(iso.getTime())) {
    const explicit = /^(\d{4}-\d{2}-\d{2})T[\d:.]+(?:Z|[+-]\d{2}:?\d{2})$/.exec(text);
    return { at: iso, localDate: explicit ? explicit[1]! : localDateIn(iso, input.timezone) };
  }
  const phone = text ? phoneTime(text, input.timezone) : undefined;
  if (phone) return phone;
  return { at: input.receivedAt, localDate: localDateIn(input.receivedAt, input.timezone) };
}

const MONTHS: Record<string, number> = {
  янв: 1,
  фев: 2,
  мар: 3,
  апр: 4,
  мая: 5,
  май: 5,
  июн: 6,
  июл: 7,
  авг: 8,
  сен: 9,
  окт: 10,
  ноя: 11,
  дек: 12,
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

/** «17 окт. 2026 г., 15:26», «17 Oct 2026, 15:26», «17.10.2026 15:26» in a time zone. */
function phoneTime(text: string, timezone: string): { at: Date; localDate: string } | undefined {
  const named =
    /(\d{1,2})\s+([A-Za-zА-Яа-яЁё]{3,})\.?,?\s+(\d{4})(?:\s*г\.?)?,?\s*(?:at\s+)?(\d{1,2}):(\d{2})/.exec(
      text,
    );
  const numeric = /(\d{1,2})\.(\d{1,2})\.(\d{4}),?\s+(\d{1,2}):(\d{2})/.exec(text);
  let parts: [number, number, number, number, number] | undefined;
  if (named) {
    const month = MONTHS[named[2]!.toLowerCase().slice(0, 3)];
    if (month) parts = [+named[3]!, month, +named[1]!, +named[4]!, +named[5]!];
  } else if (numeric) {
    parts = [+numeric[3]!, +numeric[2]!, +numeric[1]!, +numeric[4]!, +numeric[5]!];
  }
  if (!parts) return undefined;
  const [year, month, day, hour, minute] = parts;
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return undefined;
  const at = zonedMoment(year, month, day, hour, minute, timezone);
  const pad = (value: number) => String(value).padStart(2, '0');
  return { at, localDate: `${year}-${pad(month)}-${pad(day)}` };
}

/** The moment when the wall clock of a time zone shows this date and time. */
function zonedMoment(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timezone: string,
): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const shown = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(new Date(guess));
  const get = (type: string) => Number(shown.find((part) => part.type === type)?.value);
  const asIfUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'));
  return new Date(guess - (asIfUtc - guess));
}

/** YYYY-MM-DD of a moment in a time zone. */
export function localDateIn(moment: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(moment);
}

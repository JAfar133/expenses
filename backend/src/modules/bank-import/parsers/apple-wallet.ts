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

/** When it happened: `receivedAt` if it reads as a time, else now. The date is the one the text itself shows. */
function momentOf(
  text: string | undefined,
  input: NotificationInput,
): { at: Date; localDate: string } {
  const parsed = text ? new Date(text) : undefined;
  if (text && parsed && !Number.isNaN(parsed.getTime())) {
    // An ISO time with its own offset names the date in the place where it happened
    const explicit = /^(\d{4}-\d{2}-\d{2})T[\d:.]+(?:Z|[+-]\d{2}:?\d{2})$/.exec(text);
    return { at: parsed, localDate: explicit ? explicit[1]! : localDateIn(parsed, input.timezone) };
  }
  return { at: input.receivedAt, localDate: localDateIn(input.receivedAt, input.timezone) };
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

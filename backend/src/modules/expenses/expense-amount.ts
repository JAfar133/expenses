import { validationError } from '../../errors/app-error.ts';
import type { ExpenseOriginal } from '../../storage/expense.repository.ts';

/** Maximum amount in drams: the amount column holds an integer (int4). */
const MAX_AMOUNT = 2_147_483_647;
/** Reasonable rate limit: protects against a typo in manual input and against column overflow. */
const MAX_RATE = 1_000_000;
const RATE_DECIMALS = 1_000_000;

export interface AmountInput {
  amount: number;
  currency: string;
  /** Manual rate; if omitted: the rate from the reference */
  manualRate?: number;
}

export interface ResolvedAmount {
  /** Amount in drams: goes to Excel */
  amount: number;
  /** Original amount and rate; absent for dram expenses */
  original?: ExpenseOriginal;
}

/** The amount in drams before rounding, for exact conversion into other currencies. */
interface Converted extends ResolvedAmount {
  exact: number;
}

export interface AmountContext {
  base: string;
  currencies: string[];
  rateOf: (currency: string) => Promise<number | undefined>;
}

const hasAtMostTwoDecimals = (value: number) =>
  Math.abs(value * 100 - Math.round(value * 100)) < 1e-6;

/**
 * Converts the entered amount to drams. Drams require a whole amount, a foreign currency allows cents,
 * and it is converted by the rate (manual or from the reference).
 */
export async function resolveAmount(
  input: AmountInput,
  context: AmountContext,
): Promise<ResolvedAmount> {
  const { exact: _exact, ...resolved } = await convertToDrams(input, context);
  return resolved;
}

async function convertToDrams(
  { amount, currency, manualRate }: AmountInput,
  context: AmountContext,
): Promise<Converted> {
  if (!context.currencies.includes(currency)) {
    throw validationError('INVALID_CURRENCY', 'Выберите валюту из списка');
  }

  if (currency === context.base) {
    if (!Number.isInteger(amount)) {
      throw validationError('INVALID_AMOUNT', 'Стоимость должна быть целым числом');
    }
    return { amount: checked(amount), exact: amount };
  }

  if (!hasAtMostTwoDecimals(amount)) {
    throw validationError('INVALID_AMOUNT', 'Не более двух знаков после запятой');
  }

  const rate = manualRate === undefined ? await context.rateOf(currency) : manualRate;
  if (rate === undefined) {
    throw validationError('RATE_UNAVAILABLE', 'Курс валюты недоступен. Укажите курс вручную');
  }
  if (!(rate > 0 && rate <= MAX_RATE)) {
    throw validationError('INVALID_RATE', 'Некорректный курс');
  }

  const storedRate = Math.round(rate * RATE_DECIMALS) / RATE_DECIMALS;
  return {
    amount: checked(Math.round(amount * storedRate)),
    exact: amount * storedRate,
    original: { amount, currency, rate: storedRate },
  };
}

function checked(amount: number): number {
  if (amount < 1) {
    throw validationError('INVALID_AMOUNT', 'Сумма в драммах должна быть не меньше 1');
  }
  if (amount > MAX_AMOUNT) {
    throw validationError('INVALID_AMOUNT', 'Слишком большая сумма');
  }
  return amount;
}

/** Decimal places kept for amounts in a currency: drams are whole, the others have cents. */
export const decimalsOf = (currency: string, base: string) => (currency === base ? 0 : 2);

const roundTo = (value: number, decimals: number) => {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
};

/** Currencies of the card and of the group's reporting. */
export interface MoneyCurrencies {
  cardCurrency: string;
  reportingCurrency: string;
}

export interface ResolvedMoney extends ResolvedAmount {
  cardCurrency: string;
  /** The amount in the currency of the card */
  cardAmount: number;
  reportingCurrency: string;
  /** The amount in the group's reporting currency */
  reportingAmount: number;
}

/**
 * The expense in all the currencies it is kept in: drams (the pivot, for Excel), the card's currency and the group's
 * reporting currency. The amount is entered in any available currency (by default the card's); it is converted
 * at the current rate (or the manual one). `original` is kept only when the entered currency differs from the card's.
 */
export async function resolveMoney(
  input: { amount: number; currency?: string; manualRate?: number },
  { cardCurrency, reportingCurrency }: MoneyCurrencies,
  context: AmountContext,
): Promise<ResolvedMoney> {
  const currency = input.currency ?? cardCurrency;
  const converted = await convertToDrams({ ...input, currency }, context);

  const rateOf = async (code: string): Promise<number> => {
    if (code === context.base) return 1;
    const rate =
      code === currency && input.manualRate !== undefined
        ? input.manualRate
        : await context.rateOf(code);
    if (rate === undefined || !(rate > 0)) {
      throw validationError('RATE_UNAVAILABLE', `Курс валюты ${code} недоступен`);
    }
    return rate;
  };
  const inCurrency = async (code: string) =>
    code === currency
      ? input.amount
      : roundTo(converted.exact / (await rateOf(code)), decimalsOf(code, context.base));

  const cardAmount = await inCurrency(cardCurrency);
  const reportingAmount =
    reportingCurrency === cardCurrency ? cardAmount : await inCurrency(reportingCurrency);
  if (!(cardAmount > 0) || !(reportingAmount > 0)) {
    throw validationError('INVALID_AMOUNT', 'Сумма слишком мала');
  }

  return {
    amount: converted.amount,
    ...(currency !== cardCurrency
      ? { original: converted.original ?? { amount: input.amount, currency, rate: 1 } }
      : {}),
    cardCurrency,
    cardAmount,
    reportingCurrency,
    reportingAmount,
  };
}

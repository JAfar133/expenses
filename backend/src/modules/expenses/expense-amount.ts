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
  { amount, currency, manualRate }: AmountInput,
  context: AmountContext,
): Promise<ResolvedAmount> {
  if (!context.currencies.includes(currency)) {
    throw validationError('INVALID_CURRENCY', 'Выберите валюту из списка');
  }

  if (currency === context.base) {
    if (!Number.isInteger(amount)) {
      throw validationError('INVALID_AMOUNT', 'Стоимость должна быть целым числом');
    }
    return { amount: checked(amount) };
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

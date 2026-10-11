import { validationError } from '../../errors/app-error.ts';
import type { ExpenseOriginal } from '../../storage/expense.repository.ts';

/** Наибольшая сумма в драммах: столбец amount хранит целое (int4). */
const MAX_AMOUNT = 2_147_483_647;
/** Разумный предел курса: защита от опечатки при ручном вводе и от переполнения столбца. */
const MAX_RATE = 1_000_000;
const RATE_DECIMALS = 1_000_000;

export interface AmountInput {
  amount: number;
  currency: string;
  /** Курс вручную; не указан: курс из справочника */
  manualRate?: number;
}

export interface ResolvedAmount {
  /** Сумма в драммах: идёт в Excel */
  amount: number;
  /** Исходная сумма и курс; нет для расходов в драммах */
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
 * Приводит введённую сумму к драммам. В драммах нужна целая сумма, в иностранной валюте допустимы копейки,
 * и она пересчитывается по курсу (ручному или из справочника).
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

import { currencyDigits } from '../../../shared/utils/conversion.ts';
import { formatAmount } from '../../../shared/utils/money.ts';

/** The sum of positions: the price is the cost of the whole line. Rounded to cents. */
export const sumItems = (items: { price: number }[]): number =>
  Math.round(items.reduce((sum, item) => sum + item.price, 0) * 100) / 100;

export const DISCREPANCY_HINT =
  'Сумма позиций не обязана совпадать с суммой операции: в чеке бывают скидки, чаевые и округление';

/**
 * The calm note under the positions: «Сумма позиций 12 340,50, на 120 меньше суммы операции».
 * A difference under one currency unit (rounding) is not shown at all.
 */
export function discrepancyNote(
  total: number,
  itemsSum: number,
  currency: string,
  baseCurrency: string,
): string | null {
  const difference = Math.round((total - itemsSum) * 100) / 100;
  if (Math.abs(difference) < 1) return null;
  const digits = currencyDigits(currency, baseCurrency);
  const compare = difference > 0 ? 'меньше' : 'больше';
  return `Сумма позиций ${formatAmount(itemsSum, digits)}, на ${formatAmount(Math.abs(difference), digits)} ${compare} суммы операции`;
}

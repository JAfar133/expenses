import { formatMoney } from '../../../shared/utils/money.ts';

/** The price of one unit: the position price is the cost of the whole line, so it is divided by the quantity. */
export const unitPrice = (price: number, quantity: number): number =>
  Math.round((price / quantity) * 100) / 100;

/** «0,234 × 1 990» for a position whose quantity is not 1; null otherwise. */
export function quantityLine(price: number, quantity: number): string | null {
  if (quantity === 1 || quantity <= 0) return null;
  return `${formatMoney(quantity, 3)} × ${formatMoney(unitPrice(price, quantity))}`;
}

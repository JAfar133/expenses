/** Оставляет только цифры и группирует их по тысячам: `25890` → `25 890`. */
export function formatAmountInput(value: string): string {
  const digits = value.replace(/\D/g, '').replace(/^0+(?=\d)/, '');
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

/** Разбирает введённую стоимость. Допускает пробелы между тысячами, иначе возвращает null. */
export function parseAmount(value: string): number | null {
  const compact = value.replace(/[\s ]/g, '');
  return /^\d+$/.test(compact) ? Number(compact) : null;
}

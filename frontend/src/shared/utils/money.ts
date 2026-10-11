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

interface DecimalInputOptions {
  /** Сколько знаков после запятой можно ввести */
  maxDecimals: number;
  /** Группировать целую часть по тысячам: `1234,5` → `1 234,5` */
  group?: boolean;
}

/**
 * Приводит вводимое число с дробной частью к виду `1 234,56`: оставляет цифры и один разделитель (точка или запятая),
 * дробная часть обрезается до `maxDecimals` знаков.
 */
export function formatDecimalInput(
  value: string,
  { maxDecimals, group = false }: DecimalInputOptions,
): string {
  const cleaned = value.replace(/[^\d.,]/g, '');
  const separatorAt = cleaned.search(/[.,]/);
  const hasSeparator = separatorAt >= 0;

  const integerDigits = (hasSeparator ? cleaned.slice(0, separatorAt) : cleaned).replace(/\D/g, '');
  const integer = integerDigits.replace(/^0+(?=\d)/, '');
  const fraction = hasSeparator
    ? cleaned
        .slice(separatorAt + 1)
        .replace(/\D/g, '')
        .slice(0, maxDecimals)
    : '';

  const shown = group ? integer.replace(/\B(?=(\d{3})+(?!\d))/g, ' ') : integer;
  // Ведущий разделитель превращаем в «0,»: так проще вводить 0,5
  const head = shown === '' && hasSeparator ? '0' : shown;
  return hasSeparator && maxDecimals > 0 ? `${head},${fraction}` : head;
}

/** Разбирает число с запятой или точкой и пробелами между тысячами; null, если это не число. */
export function parseDecimal(value: string): number | null {
  const compact = value.replace(/[\s ]/g, '');
  return /^\d+([.,]\d+)?$/.test(compact) ? Number(compact.replace(',', '.')) : null;
}

/** Число для показа: `3990` → `3 990`, `10.5` → `10,5`. */
export function formatMoney(value: number, maxFractionDigits = 2): string {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: maxFractionDigits })
    .format(value)
    .replace(/[\s ]/g, ' ');
}

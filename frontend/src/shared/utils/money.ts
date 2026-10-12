/** Digits and spaces only: the rest (sign, fraction, exponent, letters) must not be silently cut out. */
const WHOLE_NUMBER_INPUT = /^[\d\s\u00a0]*$/;
/** Digits and spaces with at most one decimal separator. */
const DECIMAL_NUMBER_INPUT = /^[\d\s\u00a0]*[.,]?[\d\s\u00a0]*$/;

/**
 * Groups digits by thousands: `25890` → `25 890`.
 * Input with other characters (`-500`, `12.50`, `1e3`) is returned as is, so that validation reports it
 * instead of the amount silently turning into a different number.
 */
export function formatAmountInput(value: string): string {
  if (!WHOLE_NUMBER_INPUT.test(value)) return value;
  const digits = value.replace(/\D/g, '').replace(/^0+(?=\d)/, '');
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

/** Parses an entered cost. Allows spaces between thousands, otherwise returns null. */
export function parseAmount(value: string): number | null {
  const compact = value.replace(/[\s ]/g, '');
  return /^\d+$/.test(compact) ? Number(compact) : null;
}

interface DecimalInputOptions {
  /** How many decimals may be entered */
  maxDecimals: number;
  /** Group the integer part by thousands: `1234,5` → `1 234,5` */
  group?: boolean;
}

/**
 * Normalizes an entered number with a fraction to `1 234,56`: digits and one separator (dot or comma),
 * the fraction is truncated to `maxDecimals` digits.
 * Input with a sign, an exponent, letters or several separators is returned as is (validation rejects it).
 */
export function formatDecimalInput(
  value: string,
  { maxDecimals, group = false }: DecimalInputOptions,
): string {
  if (!DECIMAL_NUMBER_INPUT.test(value)) return value;
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
  // A leading separator becomes "0,": this makes entering 0,5 easier
  const head = shown === '' && hasSeparator ? '0' : shown;
  return hasSeparator && maxDecimals > 0 ? `${head},${fraction}` : head;
}

/** Parses a number with a comma or dot and spaces between thousands; null if it is not a number. */
export function parseDecimal(value: string): number | null {
  const compact = value.replace(/[\s ]/g, '');
  return /^\d+([.,]\d+)?$/.test(compact) ? Number(compact.replace(',', '.')) : null;
}

/**
 * Number for display: `3990` → `3 990`, `10.5` → `10,50`. A fractional amount always has two decimals
 * (`1 000,30`, not `1 000,3`); a whole one has none. Other precisions (percentages, rates) pass `maxFractionDigits`.
 */
export function formatMoney(value: number, maxFractionDigits = 2): string {
  const minimumFractionDigits = maxFractionDigits === 2 && !Number.isInteger(value) ? 2 : 0;
  return new Intl.NumberFormat('ru-RU', {
    minimumFractionDigits,
    maximumFractionDigits: maxFractionDigits,
  })
    .format(value)
    .replace(/[\s ]/g, ' ');
}

/** An amount of money with exactly `digits` decimals (the precision of its currency: 0 for drams, 2 for the rest). */
export function formatAmount(value: number, digits: number): string {
  return new Intl.NumberFormat('ru-RU', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
    .format(value)
    .replace(/[\s ]/g, ' ');
}

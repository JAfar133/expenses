/** «1,540.00», «1 540,00», «1.540,25», «1540» → a number with at most two decimals; undefined when it is not one. */
export function parseAmount(text: string): number | undefined {
  const compact = text.replace(/[\s ]/g, '');
  if (!/^\d[\d.,]*$/.test(compact)) return undefined;
  const lastDot = compact.lastIndexOf('.');
  const lastComma = compact.lastIndexOf(',');
  const decimalAt = Math.max(lastDot, lastComma);
  let normalized: string;
  if (decimalAt < 0) {
    normalized = compact;
  } else if (lastDot >= 0 && lastComma >= 0) {
    // Both signs: the last one is the decimal point, the other groups thousands
    normalized =
      compact.slice(0, decimalAt).replace(/[.,]/g, '') + '.' + compact.slice(decimalAt + 1);
  } else {
    const tail = compact.length - decimalAt - 1;
    // A single separator followed by exactly three digits groups thousands («1,540»); otherwise it is decimal
    normalized =
      tail === 3 && compact.indexOf(compact[decimalAt]!) === decimalAt
        ? compact.replace(/[.,]/g, '')
        : compact.slice(0, decimalAt).replace(/[.,]/g, '') + '.' + compact.slice(decimalAt + 1);
  }
  const value = Number(normalized);
  return Number.isFinite(value) ? Math.round(value * 100) / 100 : undefined;
}

const SYMBOLS: Record<string, string> = { '֏': 'AMD', '₽': 'RUB', $: 'USD', '€': 'EUR' };
const NUMBER = String.raw`\d[\d\s .,]*`;
const CODE = String.raw`[A-Za-z]{3}`;

export interface MoneyText {
  amount: number;
  /** undefined: the text has an amount but no currency */
  currency?: string;
}

/**
 * An amount with its currency out of free text: «1950 AMD», «AMD 1,950.00», «-1 950 ֏», «$12.50», or just «1950».
 * A number counts only when it stands next to a currency (so «Kiosk 4 — 1950 AMD» gives 1950, not 4); a text that
 * is only a number is the amount itself.
 */
export function readMoney(text: string): MoneyText | undefined {
  const value = text.trim();
  if (!value) return undefined;
  const patterns: [RegExp, 'number-first' | 'code-first' | 'symbol-first' | 'symbol-last'][] = [
    [new RegExp(`(${NUMBER}?)\\s*(${CODE})(?![A-Za-z])`, 'g'), 'number-first'],
    [new RegExp(`(?<![A-Za-z])(${CODE})\\s*(${NUMBER})`, 'g'), 'code-first'],
    [new RegExp(`([₽$€])\\s*(${NUMBER})`, 'g'), 'symbol-first'],
    [new RegExp(`(${NUMBER}?)\\s*([₽€֏])`, 'g'), 'symbol-last'],
  ];
  for (const [pattern, kind] of patterns) {
    for (const match of value.matchAll(pattern)) {
      const numberText = kind === 'number-first' || kind === 'symbol-last' ? match[1] : match[2];
      const currencyText = kind === 'number-first' || kind === 'symbol-last' ? match[2] : match[1];
      const amount = parseAmount(numberText ?? '');
      if (amount === undefined) continue;
      const currency = SYMBOLS[currencyText!] ?? currencyText!.toUpperCase();
      return { amount, currency };
    }
  }
  const bare = parseAmount(value.replace(/^[-+−]/, ''));
  return bare === undefined ? undefined : { amount: bare };
}

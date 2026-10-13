/** Country flags for the currency picker. Other currencies get a neutral icon. */
const FLAGS: Record<string, string> = {
  AMD: '🇦🇲',
  RUB: '🇷🇺',
  USD: '🇺🇸',
  EUR: '🇪🇺',
  GBP: '🇬🇧',
  GEL: '🇬🇪',
  CHF: '🇨🇭',
  JPY: '🇯🇵',
  CNY: '🇨🇳',
  TRY: '🇹🇷',
  KZT: '🇰🇿',
  UAH: '🇺🇦',
  AED: '🇦🇪',
};

/** The flag of a currency, or nothing for an unknown one (the tiles show the bare code then). */
export const knownFlag = (code: string): string | undefined => FLAGS[code];

export const flagOf = (code: string) => FLAGS[code] ?? '💱';

/** «🇺🇸 USD» */
export const currencyLabel = (code: string) => `${flagOf(code)} ${code}`;

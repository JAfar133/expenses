/** Флаги стран для выбора валюты. Для остальных валют показывается нейтральный значок. */
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

export const flagOf = (code: string) => FLAGS[code] ?? '💱';

/** «🇺🇸 USD» */
export const currencyLabel = (code: string) => `${flagOf(code)} ${code}`;

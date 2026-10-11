import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useRates } from '../../expenses/hooks/useRates.ts';
import { usePreference } from '../../preferences/hooks/usePreferences.ts';
import { moneyDigits, scaleFactor } from '../model/currency.ts';
import { useAnalyticsReference } from './useAnalyticsReference.ts';

export interface DisplayCurrency {
  /** Currency in which amounts are shown */
  code: string;
  /** Base currency: amounts are stored in it */
  base: string;
  /** Conversion multiplier from the base currency (1 for the base) */
  factor: number;
  /** Decimal places for money amounts */
  digits: number;
  /** Selectable currencies: the base and those that have a rate */
  options: string[];
  select: (code: string) => void;
  /** Rate of the selected currency (drams per unit) and when it was obtained; absent for the base currency */
  rate?: { rate: number; fetchedAt: string };
}

const DEFAULT: DisplayCurrency = {
  code: 'AMD',
  base: 'AMD',
  factor: 1,
  digits: 0,
  options: ['AMD'],
  select: () => undefined,
};

const Context = createContext<DisplayCurrency>(DEFAULT);

/** Display currency of amounts on the analytics page. The preference is stored in user settings. */
export function DisplayCurrencyProvider({ children }: { children: ReactNode }) {
  const [preferred, setPreferred] = usePreference('analytics.currency');
  const { currency: base } = useAnalyticsReference();
  const rates = useRates().data?.rates;

  const value = useMemo<DisplayCurrency>(() => {
    const options = [base, ...(rates ?? []).map((item) => item.currency)];
    // The selected currency may be missing (no rate or removed from settings): then show the base
    const code = options.includes(preferred) ? preferred : base;
    const rate = rates?.find((item) => item.currency === code);

    return {
      code,
      base,
      factor: scaleFactor(code, base, rates),
      digits: moneyDigits(code, base),
      options,
      select: (next) => setPreferred(next as typeof preferred),
      rate: rate && { rate: rate.rate, fetchedAt: rate.fetchedAt },
    };
  }, [base, rates, preferred, setPreferred]);

  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export const useDisplayCurrency = () => useContext(Context);

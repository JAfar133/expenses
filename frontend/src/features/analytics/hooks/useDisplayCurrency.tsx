import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useRates } from '../../expenses/hooks/useRates.ts';
import { useChosenPreference, usePreference } from '../../preferences/hooks/usePreferences.ts';
import { crossRate } from '../../../shared/utils/conversion.ts';
import { moneyDigits, scaleFactor } from '../model/currency.ts';
import { useAnalyticsReference } from './useAnalyticsReference.ts';

export interface DisplayCurrency {
  /** Currency in which amounts are shown */
  code: string;
  /** Reporting currency of the group: amounts from the server are in it */
  base: string;
  /** Conversion multiplier from the reporting currency (1 for itself) */
  factor: number;
  /** Decimal places for money amounts */
  digits: number;
  /** Selectable currencies: the reporting one, those that have a rate and drams */
  options: string[];
  select: (code: string) => void;
  /** How many reporting units one unit of the selected currency costs, and the date of its rate; absent for the reporting currency */
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
  const [, setPreferred] = usePreference('analytics.currency');
  const chosen = useChosenPreference('analytics.currency');
  const { currency: base, baseCurrency: pivot } = useAnalyticsReference();
  const rates = useRates().data?.rates;

  const value = useMemo<DisplayCurrency>(() => {
    const options = [...new Set([base, ...(rates ?? []).map((item) => item.currency), pivot])];
    // The selected currency may be missing (no rate or removed from settings): then show the reporting one
    const code = chosen && options.includes(chosen) ? chosen : base;
    const rate = rates?.find((item) => item.currency === code);
    // Drams have no rate of their own: the date is taken from the reporting currency's one
    const date = (rate ?? rates?.find((item) => item.currency === base))?.fetchedAt;
    const cross = code === base ? undefined : crossRate(rates, code, base, pivot);

    return {
      code,
      base,
      factor: scaleFactor(code, base, rates, pivot),
      digits: moneyDigits(code, pivot),
      options,
      select: (next) => setPreferred(next as Parameters<typeof setPreferred>[0]),
      rate: cross !== undefined && date ? { rate: cross, fetchedAt: date } : undefined,
    };
  }, [base, pivot, rates, chosen, setPreferred]);

  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export const useDisplayCurrency = () => useContext(Context);

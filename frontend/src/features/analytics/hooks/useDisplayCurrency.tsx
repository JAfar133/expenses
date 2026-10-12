import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useConfig } from '../../expenses/hooks/useConfig.ts';
import { useRates } from '../../expenses/hooks/useRates.ts';
import {
  useChosenPreference,
  usePreference,
  usePreferences,
} from '../../preferences/hooks/usePreferences.ts';
import { moneyDigits } from '../model/currency.ts';
import { useAnalyticsReference } from './useAnalyticsReference.ts';

export interface DisplayCurrency {
  /** Currency in which amounts are shown: sent as `currency=` to every analytics request, the server sums in it */
  code: string;
  /** Reporting currency of the group (the default of the server) */
  base: string;
  /** Decimal places for money amounts */
  digits: number;
  /** Selectable currencies: the reporting one, those that have a rate and drams */
  options: string[];
  select: (code: string) => void;
}

const DEFAULT: DisplayCurrency = {
  code: 'AMD',
  base: 'AMD',
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
  const settled = [useConfig(), useRates(), usePreferences()].every((query) => !query.isPending);

  const value = useMemo<DisplayCurrency>(() => {
    const options = [...new Set([base, ...(rates ?? []).map((item) => item.currency), pivot])];
    // The selected currency may be missing (no rate or removed from settings): then show the reporting one
    const code = chosen && options.includes(chosen) ? chosen : base;

    return {
      code,
      base,
      digits: moneyDigits(code, pivot),
      options,
      select: (next) => setPreferred(next as Parameters<typeof setPreferred>[0]),
    };
  }, [base, pivot, rates, chosen, setPreferred]);

  // Requests carry the display currency: wait until it is known, so the page does not fetch the wrong one first
  if (!settled) {
    return (
      <p role="status" className="py-8 text-center text-zinc-500">
        Загрузка…
      </p>
    );
  }

  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export const useDisplayCurrency = () => useContext(Context);

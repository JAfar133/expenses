import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useRates } from '../../expenses/hooks/useRates.ts';
import { usePreference } from '../../preferences/hooks/usePreferences.ts';
import { moneyDigits, scaleFactor } from '../model/currency.ts';
import { useAnalyticsReference } from './useAnalyticsReference.ts';

export interface DisplayCurrency {
  /** Валюта, в которой показываются суммы */
  code: string;
  /** Базовая валюта: в ней хранятся суммы */
  base: string;
  /** Множитель пересчёта из базовой валюты (1 для базовой) */
  factor: number;
  /** Знаков после запятой у денежных сумм */
  digits: number;
  /** Валюты, которые можно выбрать: базовая и те, у которых есть курс */
  options: string[];
  select: (code: string) => void;
  /** Курс выбранной валюты (драммы за единицу) и когда он получен; нет у базовой валюты */
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

/** Валюта показа сумм на странице анализа. Предпочтение хранится в настройках пользователя. */
export function DisplayCurrencyProvider({ children }: { children: ReactNode }) {
  const [preferred, setPreferred] = usePreference('analytics.currency');
  const { currency: base } = useAnalyticsReference();
  const rates = useRates().data?.rates;

  const value = useMemo<DisplayCurrency>(() => {
    const options = [base, ...(rates ?? []).map((item) => item.currency)];
    // Выбранной валюты может не быть (нет курса или её убрали из настроек): тогда показываем базовую
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

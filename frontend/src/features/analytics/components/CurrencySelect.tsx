import { formatMoney } from '../../../shared/utils/money.ts';
import { useDisplayCurrency } from '../hooks/useDisplayCurrency.tsx';
import { currencyLabel } from '../model/currency.ts';
import { ChartTypeSwitch } from './ChartTypeSwitch.tsx';

/** Date like "10.10.2026" from an ISO timestamp. */
const shortDate = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;

/** Columns of the switch on phones: one per currency, at most four. */
const columnsFor = (count: number) => Math.min(Math.max(count, 2), 4) as 2 | 3 | 4;

/**
 * Display currency switch: flag and code per option.
 * The line below always takes one row, so the layout does not jump when the rate note appears.
 */
export function CurrencySelect() {
  const { code, base, options, select, rate } = useDisplayCurrency();
  if (options.length < 2) return null;

  return (
    <div className="flex flex-col gap-1 sm:items-end">
      <ChartTypeSwitch
        label="Валюта отображения"
        options={options.map((option) => ({ value: option, label: currencyLabel(option) }))}
        value={code}
        onChange={select}
        mobileColumns={columnsFor(options.length)}
      />
      <p className="h-4 text-xs text-zinc-500 dark:text-zinc-400">
        {rate
          ? `1 ${code} = ${formatMoney(rate.rate, 4)} ${base} · курс ЦБ на ${shortDate(rate.fetchedAt)}`
          : `Суммы в ${base}`}
      </p>
    </div>
  );
}

import { useDisplayCurrency } from '../hooks/useDisplayCurrency.tsx';
import { currencyLabel } from '../model/currency.ts';
import { ChartTypeSwitch } from './ChartTypeSwitch.tsx';

/** Columns of the switch on phones: one per currency, at most four. */
const columnsFor = (count: number) => Math.min(Math.max(count, 2), 4) as 2 | 3 | 4;

/**
 * Display currency switch: flag and code per option.
 * The note below says how the amounts were obtained.
 */
export function CurrencySelect() {
  const { code, base, options, select } = useDisplayCurrency();
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
      <p className="min-h-4 text-xs text-zinc-500 dark:text-zinc-400">
        {code === base
          ? `Суммы в ${base}`
          : `Траты в ${code} показаны как введены, остальные пересчитаны по курсу ЦБ на день траты`}
      </p>
    </div>
  );
}

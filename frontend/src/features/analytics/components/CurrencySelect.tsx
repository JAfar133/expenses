import { formatMoney } from '../../../shared/utils/money.ts';
import { useDisplayCurrency } from '../hooks/useDisplayCurrency.tsx';
import { currencyLabel } from '../model/currency.ts';

/** Дата в виде «10.10.2026» из ISO-времени. */
const shortDate = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;

/** Выбор валюты показа сумм: в списке флаг страны и код валюты. Под ним курс, по которому идёт пересчёт. */
export function CurrencySelect() {
  const { code, base, options, select, rate } = useDisplayCurrency();
  if (options.length < 2) return null;

  return (
    <div className="flex flex-col items-end gap-1">
      <select
        aria-label="Валюта отображения"
        value={code}
        onChange={(event) => select(event.target.value)}
        className="h-9 rounded-lg border border-zinc-300 bg-white px-2.5 text-sm font-medium outline-none hover:border-indigo-400 focus:border-indigo-500 dark:border-zinc-700 dark:bg-zinc-900"
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {currencyLabel(option)}
          </option>
        ))}
      </select>
      {rate && (
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          1 {code} = {formatMoney(rate.rate, 4)} {base} · курс ЦБ на {shortDate(rate.fetchedAt)}
        </p>
      )}
    </div>
  );
}

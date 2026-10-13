import { useEffect, useState } from 'react';
import { ChevronDownIcon, InfoIcon } from '../../../shared/ui/icons.tsx';
import { currencyDigits } from '../../../shared/utils/conversion.ts';
import { formatAmount, parseDecimal } from '../../../shared/utils/money.ts';
import { ChartTypeSwitch } from '../../analytics/components/ChartTypeSwitch.tsx';
import { emptyDraft, isAiGenerated, type DraftItem } from '../model/draft-items.ts';
import { sumItems } from '../model/items-sum.ts';
import { ItemsEditor } from './ItemsEditor.tsx';
import { ItemsReadOnly } from './ItemsReadOnly.tsx';

type Mode = 'simple' | 'edit';

const MODES = [
  { value: 'simple', label: 'Простой вид' },
  { value: 'edit', label: 'Редактирование' },
] as const;

const DIFFERENCE_HINT = 'Бывают скидки, бонусы, чаевые и округление';

interface ReceiptItemsFieldProps {
  value: DraftItem[];
  onChange: (value: DraftItem[]) => void;
  error?: string;
  /** The typed amount of the expense, to note a difference with the sum of the positions */
  amount: number | null;
  currency: string;
  baseCurrency: string;
}

const isBlank = (row: DraftItem) => !row.name.trim() && !row.price.trim() && !row.quantity.trim();

/**
 * Under the «Добавить» form. Nothing but a quiet link «+ Позиции чека» (manual entry opens the editor at once).
 * Positions that came from a receipt show as a folded card «Позиции чека (5) 2 095,66 AMD ▾»; unfolded, the simple
 * read-only view is the default, with a switch to editing. The sum is never recalculated from the positions.
 */
export function ReceiptItemsField({
  value,
  onChange,
  error,
  amount,
  currency,
  baseCurrency,
}: ReceiptItemsFieldProps) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>('simple');

  // No rows left (deleted or the expense was saved): back to the quiet link
  useEffect(() => {
    if (value.length === 0) {
      setOpen(false);
      setMode('simple');
    }
  }, [value.length]);

  if (value.length === 0) {
    return (
      <div className="space-y-2">
        <button
          type="button"
          onClick={() => {
            onChange([emptyDraft()]);
            setMode('edit');
            setOpen(true);
          }}
          className="text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-400"
        >
          + Позиции чека
        </button>
        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      </div>
    );
  }

  const digits = currencyDigits(currency, baseCurrency);
  const filled = value.filter((row) => !isBlank(row));
  const sum = sumItems(filled.map((row) => ({ price: parseDecimal(row.price) ?? 0 })));
  const difference = amount === null || filled.length === 0 ? 0 : Math.abs(amount - sum);

  return (
    <div className="space-y-2">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className="flex min-h-11 w-full items-center justify-between gap-3 rounded-xl border border-zinc-200 px-3 text-left text-sm dark:border-zinc-700"
      >
        <span className="font-medium">Позиции чека ({filled.length})</span>
        <span className="flex items-center gap-2 text-zinc-500 dark:text-zinc-400">
          <span className="tabular-nums">
            {formatAmount(sum, digits)} {currency}
          </span>
          <span aria-hidden="true" className={`transition ${open ? 'rotate-180' : ''}`}>
            <ChevronDownIcon />
          </span>
        </span>
      </button>

      {open && (
        <div className="space-y-3 rounded-xl bg-zinc-50 p-3 dark:bg-zinc-800/40">
          <ChartTypeSwitch
            label="Вид позиций"
            options={MODES}
            value={mode}
            onChange={setMode}
            mobileColumns={2}
            fullWidth
          />
          {mode === 'edit' ? (
            <ItemsEditor value={value} onChange={onChange} />
          ) : (
            <ItemsReadOnly
              rows={filled.map((row) => ({
                key: row.key,
                name: row.name,
                price: parseDecimal(row.price) ?? 0,
                quantity: parseDecimal(row.quantity) || 1,
                ai: isAiGenerated(row),
              }))}
              currency={currency}
              baseCurrency={baseCurrency}
            />
          )}
          <div className="border-t border-zinc-200 pt-2 text-sm font-semibold dark:border-zinc-700">
            Сумма позиций {formatAmount(sum, digits)} {currency}
          </div>
          {difference >= 1 && (
            <p
              title={DIFFERENCE_HINT}
              className="flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400"
            >
              <InfoIcon />
              Сумма расхода отличается от суммы позиций на {formatAmount(difference, digits)}{' '}
              {currency}
            </p>
          )}
        </div>
      )}
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}

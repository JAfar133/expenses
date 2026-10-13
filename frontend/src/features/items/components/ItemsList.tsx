import { currencyDigits } from '../../../shared/utils/conversion.ts';
import { formatAmount, formatMoney } from '../../../shared/utils/money.ts';
import { AiMark } from '../../ai/components/AiMark.tsx';
import type { ExpenseItem } from '../api/items.api.ts';
import { DISCREPANCY_HINT, discrepancyNote, sumItems } from '../model/items-sum.ts';

interface ItemsListProps {
  items: ExpenseItem[];
  /** Currency of the card: the prices and the amount of the operation are in it */
  currency: string;
  baseCurrency: string;
  /** The amount of the operation, to note a difference with the sum of the positions */
  operationAmount: number;
}

/**
 * Positions of a receipt, read only, as a block over the whole width of the card: the name (and the quantity under it)
 * on the left, the price aligned to the right, thin lines between the rows, the sum of the positions at the bottom.
 */
export function ItemsList({ items, currency, baseCurrency, operationAmount }: ItemsListProps) {
  const digits = currencyDigits(currency, baseCurrency);
  const sum = sumItems(items);
  const note = discrepancyNote(operationAmount, sum, currency, baseCurrency);

  return (
    <div className="rounded-xl bg-zinc-50 px-3 py-1 dark:bg-zinc-800/40">
      <ul aria-label="Позиции" className="divide-y divide-zinc-200 text-sm dark:divide-zinc-700">
        {items.map((item) => (
          <li key={item.id} className="flex items-start justify-between gap-3 py-2">
            <div className="min-w-0">
              <span className="break-words">{item.name}</span> {item.source === 'ai' && <AiMark />}
              {item.quantity !== 1 && (
                <div className="text-xs text-zinc-500 dark:text-zinc-400">
                  × {formatMoney(item.quantity, 3)}
                </div>
              )}
            </div>
            <span className="shrink-0 text-right tabular-nums">
              {formatAmount(item.price, digits)}
            </span>
          </li>
        ))}
      </ul>
      <div className="border-t border-zinc-200 py-2 text-xs text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
        <div>Сумма позиций {formatAmount(sum, digits)}</div>
        {note && (
          <div title={DISCREPANCY_HINT} className="mt-0.5">
            {note}
          </div>
        )}
      </div>
    </div>
  );
}

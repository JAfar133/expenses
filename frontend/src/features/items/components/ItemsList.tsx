import { currencyDigits } from '../../../shared/utils/conversion.ts';
import { formatAmount } from '../../../shared/utils/money.ts';
import type { ExpenseItem } from '../api/items.api.ts';
import { DISCREPANCY_HINT, discrepancyNote, sumItems } from '../model/items-sum.ts';
import { ItemsReadOnly } from './ItemsReadOnly.tsx';

interface ItemsListProps {
  items: ExpenseItem[];
  /** Currency of the card: the prices and the amount of the operation are in it */
  currency: string;
  baseCurrency: string;
  /** The amount of the operation, to note a difference with the sum of the positions */
  operationAmount: number;
}

/**
 * Positions of a receipt in the operations list, read only, as a block over the whole width of the card.
 * On a wide screen the rows scroll inside the block (at most 320px high); on a phone they do not.
 */
export function ItemsList({ items, currency, baseCurrency, operationAmount }: ItemsListProps) {
  const digits = currencyDigits(currency, baseCurrency);
  const sum = sumItems(items);
  const note = discrepancyNote(operationAmount, sum, currency, baseCurrency);

  return (
    <div className="rounded-xl bg-zinc-50 px-3 py-1 dark:bg-zinc-800/40">
      <div className="md:max-h-80 md:overflow-y-auto">
        <ItemsReadOnly
          rows={items.map((item) => ({
            key: item.id,
            name: item.name,
            price: item.price,
            quantity: item.quantity,
            ai: item.source === 'ai',
          }))}
          currency={currency}
          baseCurrency={baseCurrency}
        />
      </div>
      <div className="border-t border-zinc-200 py-2 dark:border-zinc-700">
        <div className="text-sm font-semibold">
          Сумма позиций {formatAmount(sum, digits)} {currency}
        </div>
        {note && (
          <div title={DISCREPANCY_HINT} className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
            {note}
          </div>
        )}
      </div>
    </div>
  );
}

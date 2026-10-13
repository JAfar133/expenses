import { useItems } from '../hooks/useItems.ts';
import { ItemsList } from './ItemsList.tsx';

interface ItemsPanelProps {
  expenseId: string;
  currency: string;
  baseCurrency: string;
  operationAmount: number;
}

/** The opened positions of a row: loaded only when somebody looks. */
export function ItemsPanel({
  expenseId,
  currency,
  baseCurrency,
  operationAmount,
}: ItemsPanelProps) {
  const items = useItems(expenseId);
  return (
    <div className="mt-2 border-t border-zinc-100 pt-2 dark:border-zinc-800">
      {items.isPending && <p className="text-xs text-zinc-400">Загрузка…</p>}
      {items.isError && <p className="text-xs text-zinc-400">Не удалось загрузить позиции</p>}
      {items.data && (
        <ItemsList
          items={items.data}
          currency={currency}
          baseCurrency={baseCurrency}
          operationAmount={operationAmount}
        />
      )}
    </div>
  );
}

import { useCollapse } from '../hooks/useCollapse.ts';
import { useItems } from '../hooks/useItems.ts';
import { ItemsList } from './ItemsList.tsx';

interface ItemsPanelProps {
  expenseId: string;
  open: boolean;
  currency: string;
  baseCurrency: string;
  operationAmount: number;
}

/**
 * The opened positions of a row: loaded only when somebody looks; they grow down under the row (grid rows 0fr → 1fr,
 * a short fade, no animation with reduced motion) and never move anything above them.
 */
export function ItemsPanel({
  expenseId,
  open,
  currency,
  baseCurrency,
  operationAmount,
}: ItemsPanelProps) {
  const { mounted, shown } = useCollapse(open);
  if (!mounted) return null;
  return (
    <div
      aria-hidden={!open}
      className={`grid [overflow-anchor:none] transition-[grid-template-rows,opacity] duration-150 motion-reduce:transition-none ${
        shown ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
      }`}
    >
      <div className="min-h-0 overflow-hidden">
        <PanelBody
          expenseId={expenseId}
          currency={currency}
          baseCurrency={baseCurrency}
          operationAmount={operationAmount}
        />
      </div>
    </div>
  );
}

function PanelBody({
  expenseId,
  currency,
  baseCurrency,
  operationAmount,
}: Omit<ItemsPanelProps, 'open'>) {
  const items = useItems(expenseId);
  return (
    <div className="border-t border-zinc-100 pt-2 dark:border-zinc-800">
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

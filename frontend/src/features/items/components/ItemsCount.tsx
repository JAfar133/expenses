import { useState } from 'react';
import { useItems } from '../hooks/useItems.ts';
import { itemsLabel } from '../model/plural.ts';
import { ItemsList } from './ItemsList.tsx';

/** In a row of the operations list: a muted «3 позиции»; a click opens the list under it. */
export function ItemsCount({ expenseId, count }: { expenseId: string; count: number }) {
  const [open, setOpen] = useState(false);
  const items = useItems(expenseId, open);

  return (
    <div className="mt-0.5">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className="text-xs text-zinc-500 hover:text-zinc-800 hover:underline dark:text-zinc-400 dark:hover:text-zinc-200"
      >
        {itemsLabel(count)}
      </button>
      {open && (
        <div className="mt-1">
          {items.isPending && <p className="text-xs text-zinc-400">Загрузка…</p>}
          {items.isError && <p className="text-xs text-zinc-400">Не удалось загрузить позиции</p>}
          {items.data && <ItemsList items={items.data} />}
        </div>
      )}
    </div>
  );
}

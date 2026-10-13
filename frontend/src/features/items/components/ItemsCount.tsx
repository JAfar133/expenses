import { ChevronDownIcon } from '../../../shared/ui/icons.tsx';
import { itemsLabel } from '../model/plural.ts';

interface ItemsCountProps {
  count: number;
  open: boolean;
  onToggle: () => void;
}

/** In a row of the operations list: a muted «3 позиции ▾» button; the list itself opens as a block under the row. */
export function ItemsCount({ count, open, onToggle }: ItemsCountProps) {
  return (
    <button
      type="button"
      aria-expanded={open}
      onClick={onToggle}
      className="mt-0.5 flex min-h-11 items-center gap-1 rounded-lg pr-2 text-xs text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200 md:min-h-8"
    >
      {itemsLabel(count)}
      <span aria-hidden="true" className={`transition ${open ? 'rotate-180' : ''}`}>
        <ChevronDownIcon />
      </span>
    </button>
  );
}

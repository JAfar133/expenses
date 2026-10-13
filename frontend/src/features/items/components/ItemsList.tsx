import { formatMoney } from '../../../shared/utils/money.ts';
import { AiMark } from '../../ai/components/AiMark.tsx';
import type { ExpenseItem } from '../api/items.api.ts';

/** Positions of a receipt, read only. */
export function ItemsList({ items }: { items: ExpenseItem[] }) {
  return (
    <ul aria-label="Позиции" className="space-y-0.5 text-sm text-zinc-600 dark:text-zinc-300">
      {items.map((item) => (
        <li key={item.id} className="flex items-baseline justify-between gap-3">
          <span className="min-w-0">
            {item.name}
            {item.quantity !== 1 && (
              <span className="text-zinc-400"> × {formatMoney(item.quantity, 3)}</span>
            )}{' '}
            {item.source === 'ai' && <AiMark />}
          </span>
          <span className="shrink-0 tabular-nums">{formatMoney(item.price)}</span>
        </li>
      ))}
    </ul>
  );
}

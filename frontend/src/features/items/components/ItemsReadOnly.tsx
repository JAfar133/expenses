import { currencyDigits } from '../../../shared/utils/conversion.ts';
import { formatAmount } from '../../../shared/utils/money.ts';
import { AiMark } from '../../ai/components/AiMark.tsx';
import { quantityLine } from '../model/unit-price.ts';

/** A position for display: the price is the cost of the whole line. */
export interface ViewItem {
  key: string;
  name: string;
  price: number;
  quantity: number;
  ai: boolean;
}

interface ItemsReadOnlyProps {
  rows: ViewItem[];
  currency: string;
  baseCurrency: string;
}

/** The simple view of positions: the name (with the AI spark) and «qty × unit» under it, the price at the right. */
export function ItemsReadOnly({ rows, currency, baseCurrency }: ItemsReadOnlyProps) {
  const digits = currencyDigits(currency, baseCurrency);
  return (
    <ul aria-label="Позиции" className="divide-y divide-zinc-200 text-sm dark:divide-zinc-700">
      {rows.map((row) => {
        const line = quantityLine(row.price, row.quantity);
        return (
          <li key={row.key} className="flex items-start justify-between gap-3 py-2">
            <div className="min-w-0">
              <span className="break-words">{row.name}</span> {row.ai && <AiMark />}
              {line && <div className="text-xs text-zinc-500 dark:text-zinc-400">{line}</div>}
            </div>
            <span className="shrink-0 text-right tabular-nums">
              {formatAmount(row.price, digits)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

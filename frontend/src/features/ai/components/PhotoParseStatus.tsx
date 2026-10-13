import { CheckIcon } from '../../../shared/ui/icons.tsx';
import { formatMoney } from '../../../shared/utils/money.ts';
import { sumItems } from '../../items/model/items-sum.ts';
import { goodsLabel } from '../../items/model/plural.ts';
import type { PhotoParseState } from '../hooks/usePhotoParse.ts';

/**
 * The card next to the photo: reading (calm, the form is not blocked), recognised («Найдено 5 товаров · 2 095,66 AMD»)
 * or a soft yellow one with «Повторить».
 */
export function PhotoParseStatus({
  state,
  onRetry,
  fallbackCurrency,
}: {
  state: PhotoParseState;
  onRetry: () => void;
  /** The currency of the amount field, when the receipt names none */
  fallbackCurrency: string;
}) {
  if (state.status === 'running') {
    return (
      <div
        role="status"
        className="flex items-center gap-2 rounded-xl bg-zinc-50 px-3 py-2 text-sm text-zinc-700 dark:bg-zinc-800/60 dark:text-zinc-200"
      >
        <span
          aria-hidden="true"
          className="size-4 shrink-0 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-600"
        />
        Распознаём чек…
      </div>
    );
  }
  if (state.status === 'error') {
    return (
      <div className="space-y-1 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
        <div className="font-medium">Не удалось распознать чек</div>
        {state.reason && <div className="text-xs">{state.reason}</div>}
        <button
          type="button"
          onClick={onRetry}
          className="h-9 rounded-lg border border-amber-300 px-3 text-sm font-medium hover:bg-amber-100 dark:border-amber-800 dark:hover:bg-amber-900"
        >
          Повторить
        </button>
      </div>
    );
  }
  if (state.status === 'done') {
    const { items, total, currency } = state.result;
    const amount = total ?? sumItems(items);
    return (
      <div className="rounded-xl bg-emerald-50 px-3 py-2 text-sm dark:bg-emerald-950/50">
        <div className="flex items-center gap-1.5 font-medium text-emerald-800 dark:text-emerald-200">
          <CheckIcon />
          Чек распознан
        </div>
        <div className="text-xs text-zinc-600 dark:text-zinc-300">
          {items.length === 0
            ? 'Товары не найдены'
            : `Найдено ${goodsLabel(items.length)}${amount > 0 ? ` · ${formatMoney(amount)} ${currency ?? fallbackCurrency}` : ''}`}
        </div>
      </div>
    );
  }
  return null;
}

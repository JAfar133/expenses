import { InfoIcon } from '../../../shared/ui/icons.tsx';
import { formatMoney } from '../../../shared/utils/money.ts';

interface ReceiptTotalHintProps {
  total: number;
  /** The currency of the receipt, or the one of the field when the receipt names none */
  currency: string;
  /** Put the receipt total into the amount field; absent when the currencies differ */
  onApply?: () => void;
}

/** Under the amount field: «По чеку: 2 095,66 AMD · Подставить», quiet, with an info icon. */
export function ReceiptTotalHint({ total, currency, onApply }: ReceiptTotalHintProps) {
  return (
    <p className="-mt-3 flex items-center gap-1.5 rounded-lg bg-zinc-50 px-2.5 py-1.5 text-xs text-zinc-500 dark:bg-zinc-800/40 dark:text-zinc-400">
      <InfoIcon />
      <span>
        По чеку: {formatMoney(total)} {currency}
      </span>
      {onApply && (
        <>
          <span aria-hidden="true">·</span>
          <button
            type="button"
            onClick={onApply}
            className="font-medium text-indigo-700 hover:underline dark:text-indigo-300"
          >
            Подставить
          </button>
        </>
      )}
    </p>
  );
}

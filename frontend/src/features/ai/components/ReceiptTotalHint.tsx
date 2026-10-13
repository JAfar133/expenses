import { formatMoney } from '../../../shared/utils/money.ts';

interface ReceiptTotalHintProps {
  total: number;
  /** The currency of the receipt, or the one of the field when the receipt names none */
  currency: string;
  /** Put the receipt total into the amount field; absent when the currencies differ */
  onApply?: () => void;
}

/** Under the amount field: a quiet note of the total on the receipt, with a small «Подставить». */
export function ReceiptTotalHint({ total, currency, onApply }: ReceiptTotalHintProps) {
  return (
    <p className="-mt-3 flex items-baseline justify-between gap-3 text-xs text-zinc-500 dark:text-zinc-400">
      <span>
        На чеке {formatMoney(total)} {currency}
      </span>
      {onApply && (
        <button
          type="button"
          onClick={onApply}
          className="font-medium text-indigo-700 hover:underline dark:text-indigo-300"
        >
          Подставить
        </button>
      )}
    </p>
  );
}

import { BankIcon } from '../../../shared/ui/icons.tsx';

export const BANK_TEXT = 'Добавлено автоматически из уведомления банка';

/** A small muted marker next to the name of an expense that was created from a bank notification. */
export function BankBadge() {
  return (
    <span
      role="img"
      aria-label={BANK_TEXT}
      title={BANK_TEXT}
      className="inline-flex shrink-0 items-center text-indigo-400 dark:text-indigo-300/80 [&>svg]:size-4"
    >
      <BankIcon />
    </span>
  );
}

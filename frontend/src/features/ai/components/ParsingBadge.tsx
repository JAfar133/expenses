import { useIsParsing } from '../model/parse-state.ts';

/** «ИИ обрабатывает чек…» in the row of the expense whose receipt is being parsed. */
export function ParsingBadge({ expenseId }: { expenseId: string }) {
  if (!useIsParsing(expenseId)) return null;
  return (
    <span role="status" className="text-xs text-violet-600 dark:text-violet-400">
      ИИ обрабатывает чек…
    </span>
  );
}

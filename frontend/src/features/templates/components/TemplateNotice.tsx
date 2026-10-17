import { Toast } from '../../../shared/ui/Toast.tsx';
import type { TemplateNotice as Notice } from '../hooks/useApplyTemplate.ts';

/** How long «Отменить» stays available after an expense is created from a template. */
export const UNDO_MS = 6000;

/** The notice after a template is tapped: «Добавлено · Отменить», the cancellation or an error. */
export function TemplateNotice({
  notice,
  onUndo,
  onDismiss,
}: {
  notice: Notice;
  onUndo: (expenseId: string) => void;
  onDismiss: () => void;
}) {
  return (
    <Toast onDismiss={onDismiss} durationMs={notice.kind === 'added' ? UNDO_MS : undefined}>
      <span className="flex-1">{notice.text}</span>
      {notice.expenseId && (
        <button
          type="button"
          onClick={() => onUndo(notice.expenseId!)}
          className="shrink-0 rounded-lg px-2 py-1 font-semibold text-indigo-600 hover:bg-indigo-50 dark:text-indigo-300 dark:hover:bg-indigo-950/60"
        >
          Отменить
        </button>
      )}
    </Toast>
  );
}

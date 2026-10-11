import { Modal } from '../../../shared/ui/Modal.tsx';

interface ConfirmDialogProps {
  title: string;
  message: string;
  confirmLabel: string;
  /** Идёт выполнение: кнопки недоступны */
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Подтверждение опасного действия (например, удаления). */
export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <Modal title={title} onClose={onCancel}>
      <p className="mb-5 text-sm text-zinc-600 dark:text-zinc-300">{message}</p>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="h-11 rounded-xl border border-zinc-300 px-4 text-sm font-medium dark:border-zinc-700"
        >
          Отмена
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={busy}
          aria-busy={busy}
          className="h-11 rounded-xl bg-red-600 px-4 text-sm font-semibold text-white hover:bg-red-500 disabled:opacity-60"
        >
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

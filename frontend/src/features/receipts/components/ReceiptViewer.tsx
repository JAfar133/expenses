import { Modal } from '../../../shared/ui/Modal.tsx';
import { receiptUrl } from '../api/receipts.api.ts';

/** The photo of a receipt in a window. */
export function ReceiptViewer({ expenseId, onClose }: { expenseId: string; onClose: () => void }) {
  return (
    <Modal title="Фото чека" onClose={onClose}>
      <img
        src={receiptUrl(expenseId)}
        alt="Фото чека"
        className="mx-auto max-h-[70dvh] w-auto max-w-full rounded-lg"
      />
      <button
        type="button"
        onClick={onClose}
        className="mt-4 h-11 w-full rounded-xl border border-zinc-300 text-sm font-medium dark:border-zinc-700"
      >
        Закрыть
      </button>
    </Modal>
  );
}

import { useState } from 'react';
import { ChevronDownIcon, PencilIcon, RefreshIcon, TrashIcon } from '../../../shared/ui/icons.tsx';
import { formatMoney } from '../../../shared/utils/money.ts';
import { ConfirmDialog } from '../../analytics/components/ConfirmDialog.tsx';
import { useQueueItems } from '../hooks/useQueueItems.ts';
import { clearAllSent, requestQueueSync, useSenderState } from '../model/queue-signal.ts';
import { queueStore } from '../model/queue-store.ts';
import type { QueuedExpense } from '../model/queue-types.ts';

const iconButton =
  'flex size-11 items-center justify-center rounded-lg text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800';

function statusText(item: QueuedExpense, sending: boolean): string {
  if (item.status === 'failed') {
    return item.photoFailed
      ? 'расход отправлен, фото не загрузилось'
      : `нужно исправить: ${item.error ?? 'ошибка'}`;
  }
  return sending ? 'отправляется' : 'ждёт сети';
}

interface PendingExpensesProps {
  /** An expense taken back from the queue to be corrected in the form */
  onEdit: (item: QueuedExpense) => void;
}

/** «Не отправлено: N» above the form: the expenses kept on the device, with what to do with each. */
export function PendingExpenses({ onEdit }: PendingExpensesProps) {
  const items = useQueueItems();
  const { sendingId, allSent } = useSenderState();
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState<QueuedExpense>();

  if (items.length === 0) {
    return allSent ? (
      <p
        role="status"
        className="mb-4 rounded-xl bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200"
      >
        Все расходы отправлены
      </p>
    ) : null;
  }

  const retry = async (item: QueuedExpense) => {
    await queueStore.update(item.id, { status: 'pending', error: undefined, photoFailed: false });
    requestQueueSync();
  };

  const edit = async (item: QueuedExpense) => {
    await queueStore.remove(item.id);
    onEdit(item);
  };

  const confirmDelete = async () => {
    if (deleting) await queueStore.remove(deleting.id);
    setDeleting(undefined);
  };

  return (
    <section
      aria-label="Не отправлено"
      className="mb-4 rounded-2xl bg-amber-50 text-amber-950 dark:bg-amber-950/60 dark:text-amber-100"
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={() => {
          clearAllSent();
          setOpen((current) => !current);
        }}
        className="flex min-h-11 w-full items-center justify-between gap-2 px-4 text-sm font-semibold"
      >
        Не отправлено: {items.length}
        <span aria-hidden="true" className={open ? 'rotate-180' : ''}>
          <ChevronDownIcon />
        </span>
      </button>

      {open && (
        <ul className="divide-y divide-amber-200 px-4 pb-2 dark:divide-amber-900">
          {items.map((item) => (
            <li key={item.id} className="flex items-center gap-2 py-2 text-sm">
              <div className="min-w-0 flex-1">
                <div className="flex justify-between gap-2 font-medium">
                  <span className="truncate">{item.expense.name}</span>
                  <span className="shrink-0 tabular-nums">
                    {formatMoney(item.expense.amount)} {item.expense.currency ?? ''}
                  </span>
                </div>
                <div className="text-xs opacity-80">
                  {item.expense.date} · {item.expense.card} ·{' '}
                  {statusText(item, item.id === sendingId)}
                </div>
              </div>
              {item.status === 'failed' && (
                <button
                  type="button"
                  aria-label="Повторить"
                  title="Повторить"
                  onClick={() => void retry(item)}
                  className={iconButton}
                >
                  <RefreshIcon />
                </button>
              )}
              {!item.serverId && (
                <button
                  type="button"
                  aria-label="Изменить"
                  title="Изменить"
                  onClick={() => void edit(item)}
                  className={iconButton}
                >
                  <PencilIcon />
                </button>
              )}
              <button
                type="button"
                aria-label="Удалить"
                title="Удалить"
                onClick={() => setDeleting(item)}
                className={iconButton}
              >
                <TrashIcon />
              </button>
            </li>
          ))}
        </ul>
      )}

      {deleting && (
        <ConfirmDialog
          title="Удалить расход?"
          message={`«${deleting.expense.name}» не будет отправлен и пропадёт с устройства.`}
          confirmLabel="Удалить"
          onConfirm={() => void confirmDelete()}
          onCancel={() => setDeleting(undefined)}
        />
      )}
    </section>
  );
}

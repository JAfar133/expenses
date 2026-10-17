import type { ReactNode } from 'react';
import { CreditCardIcon, DocumentIcon, WarningIcon } from '../../../shared/ui/icons.tsx';
import type { AppNotification, NotificationType } from '../api/notifications.api.ts';
import { relativeTime } from '../model/time.ts';

const ICONS: Record<NotificationType, ReactNode> = {
  expense_imported: <CreditCardIcon />,
  import_problem: <WarningIcon />,
  receipt_parsed: <DocumentIcon />,
};

/** One notification: the type in a soft circle, title, body, time and a dot while it is unread. */
export function NotificationRow({
  item,
  onOpen,
}: {
  item: AppNotification;
  onOpen: (item: AppNotification) => void;
}) {
  const warn = item.type === 'import_problem';
  return (
    <li data-type={item.type} data-read={item.read}>
      <button
        type="button"
        onClick={() => onOpen(item)}
        className={
          'flex min-h-14 w-full items-start gap-3 rounded-xl px-2 py-2.5 text-left transition ' +
          (warn
            ? 'bg-amber-50 hover:bg-amber-100 dark:bg-amber-950/40 dark:hover:bg-amber-950/60'
            : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/60')
        }
      >
        <span
          aria-hidden="true"
          className={
            'mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full ' +
            (warn
              ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/60 dark:text-amber-300'
              : 'bg-indigo-50 text-indigo-600 dark:bg-indigo-950 dark:text-indigo-300')
          }
        >
          {ICONS[item.type]}
        </span>
        <span className="min-w-0 flex-1">
          <span
            className={
              'block text-sm ' +
              (item.read ? 'font-medium' : 'font-semibold text-zinc-900 dark:text-zinc-50')
            }
          >
            {item.title}
          </span>
          <span className="line-clamp-2 block text-sm text-zinc-600 dark:text-zinc-300">
            {item.body}
          </span>
          <span className="block text-xs text-zinc-500 dark:text-zinc-400">
            {relativeTime(item.createdAt)}
          </span>
        </span>
        {!item.read && (
          <span
            role="img"
            aria-label="Не прочитано"
            className="mt-2 size-2.5 shrink-0 rounded-full bg-indigo-600 dark:bg-indigo-400"
          />
        )}
      </button>
    </li>
  );
}

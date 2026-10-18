import { useNavigate } from 'react-router';
import { ActionMenu } from '../../../shared/ui/ActionMenu.tsx';
import {
  useDismiss,
  useMarkRead,
  useNotificationFeed,
  useUnreadCount,
} from '../hooks/useNotifications.ts';
import { badgeText } from '../model/time.ts';

/** «Уведомления» and, next to it, the number of unread (hidden at zero). */
export function PanelTitle() {
  const { data } = useUnreadCount();
  const badge = badgeText(data ?? 0);
  return (
    <>
      Уведомления
      {badge && (
        <span
          data-testid="panel-badge"
          className="flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1.5 text-xs font-bold text-white"
        >
          {badge}
        </span>
      )}
    </>
  );
}

/** The «⋯» of the header: read all, hide all, the settings of notifications. */
export function PanelMenu({
  onClose,
  onHidden,
  dismiss,
}: {
  onClose: () => void;
  onHidden: (ids: string[]) => void;
  /** The hide mutation of the bell: its error is shown in the panel */
  dismiss: ReturnType<typeof useDismiss>;
}) {
  const feed = useNotificationFeed();
  const markRead = useMarkRead();
  const navigate = useNavigate();
  const items = feed.data?.pages.flatMap((page) => page.items) ?? [];
  const unread = feed.data?.pages[0]?.unread ?? 0;

  return (
    <ActionMenu
      label="Меню уведомлений"
      actions={[
        {
          label: 'Прочитать все',
          disabled: unread === 0 || markRead.isPending,
          onSelect: () => markRead.mutate(undefined),
        },
        {
          label: 'Скрыть все',
          disabled: items.length === 0 || dismiss.isPending,
          onSelect: () =>
            dismiss.mutate(undefined, {
              onSuccess: (result) => result.ids.length > 0 && onHidden(result.ids),
            }),
        },
        {
          label: 'Настроить уведомления',
          onSelect: () => {
            onClose();
            void navigate('/settings/notifications');
          },
        },
      ]}
    />
  );
}

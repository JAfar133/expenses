import { useState } from 'react';
import { AnchoredPanel } from '../../../shared/ui/AnchoredPanel.tsx';
import { BellIcon } from '../../../shared/ui/icons.tsx';
import { useUnreadCount } from '../hooks/useNotifications.ts';
import { badgeText } from '../model/time.ts';
import { NotificationPanel } from './NotificationPanel.tsx';

/**
 * The bell in the header: a number of unread notifications on it, a popover under it on a wide screen and a bottom
 * sheet on a phone. The feed is read only while the panel is open.
 */
export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const { data } = useUnreadCount();
  const unread = data ?? 0;
  const badge = badgeText(unread);

  return (
    <AnchoredPanel
      label="Уведомления"
      open={open}
      onOpenChange={setOpen}
      align="right"
      widthClass="sm:w-96"
      trigger={(props) => (
        <button
          type="button"
          {...props}
          aria-label={unread > 0 ? `Уведомления, непрочитанных: ${unread}` : 'Уведомления'}
          className="relative flex size-11 shrink-0 items-center justify-center rounded-full text-zinc-600 hover:bg-zinc-200/60 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          <BellIcon />
          {badge && (
            <span
              aria-hidden="true"
              data-testid="bell-badge"
              className="absolute top-1 right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] leading-none font-bold text-white"
            >
              {badge}
            </span>
          )}
        </button>
      )}
    >
      <NotificationPanel onClose={() => setOpen(false)} />
    </AnchoredPanel>
  );
}

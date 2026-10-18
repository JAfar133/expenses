import { useState } from 'react';
import { Toast } from '../../../shared/ui/Toast.tsx';
import { AnchoredPanel } from '../../../shared/ui/AnchoredPanel.tsx';
import { BellIcon } from '../../../shared/ui/icons.tsx';
import {
  useDismiss,
  useNotificationStream,
  useRestore,
  useUnreadCount,
} from '../hooks/useNotifications.ts';
import { badgeText } from '../model/time.ts';
import type { AppNotification } from '../api/notifications.api.ts';
import { PanelMenu, PanelTitle } from './PanelHeader.tsx';
import { NotificationPanel } from './NotificationPanel.tsx';

/**
 * The bell in the header: a number of unread notifications on it, a popover under it on a wide screen and a bottom
 * sheet on a phone. The feed is read only while the panel is open.
 */
export function NotificationBell() {
  const [open, setOpen] = useState(false);
  // After a hide the toast offers to bring the rows back; a second hide replaces it
  const [hidden, setHidden] = useState<string[] | null>(null);
  const restore = useRestore();
  const dismiss = useDismiss();
  // The import problem whose details are shown inside the panel
  const [details, setDetails] = useState<AppNotification | null>(null);
  useNotificationStream();
  const { data } = useUnreadCount();
  const unread = data ?? 0;
  const closePanel = () => {
    setOpen(false);
    setDetails(null);
  };
  const badge = badgeText(unread);

  return (
    <>
      <AnchoredPanel
        label="Уведомления"
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setDetails(null);
        }}
        title={details ? 'Уведомление' : <PanelTitle />}
        onBack={details ? () => setDetails(null) : undefined}
        headerExtra={
          details ? undefined : (
            <PanelMenu onClose={closePanel} onHidden={setHidden} dismiss={dismiss} />
          )
        }
        maxHeightClass="max-h-[75dvh] sm:max-h-[70dvh]"
        compactBody
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
        <NotificationPanel
          onClose={closePanel}
          onHidden={setHidden}
          details={details}
          dismiss={dismiss}
          onDetails={setDetails}
        />
      </AnchoredPanel>
      {hidden && (
        <div data-panel-ignore>
          <Toast key={hidden.join(',')} durationMs={6000} onDismiss={() => setHidden(null)}>
            <span className="flex-1">Скрыто: {hidden.length}</span>
            <button
              type="button"
              onClick={() => {
                restore.mutate(hidden);
                setHidden(null);
              }}
              className="shrink-0 rounded-lg px-2 py-1 font-semibold text-indigo-600 hover:bg-indigo-50 dark:text-indigo-300 dark:hover:bg-indigo-950/60"
            >
              Вернуть
            </button>
          </Toast>
        </div>
      )}
    </>
  );
}

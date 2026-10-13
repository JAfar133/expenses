import { useEffect, useRef, useState } from 'react';
import { useOnlineStatus } from '../../../shared/hooks/useOnlineStatus.ts';
import { useQueueItems } from '../hooks/useQueueItems.ts';

export const RESTORED_VISIBLE_MS = 3000;

/**
 * The warning under the header on any page: there is no network, expenses will be kept on the device.
 * When the network returns while something waits in the queue, a calm note replaces it for a few seconds.
 */
export function OfflineBanner() {
  const online = useOnlineStatus();
  const waiting = useQueueItems().some((item) => item.status === 'pending');
  const [restored, setRestored] = useState(false);
  const wasOnline = useRef(online);
  const waitingRef = useRef(waiting);
  waitingRef.current = waiting;

  useEffect(() => {
    const comeBack = !wasOnline.current && online;
    wasOnline.current = online;
    if (!comeBack || !waitingRef.current) return;
    setRestored(true);
    const timer = setTimeout(() => setRestored(false), RESTORED_VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [online]);

  if (!online) {
    return (
      <div
        role="status"
        className="mb-4 rounded-xl bg-amber-50 px-4 py-3 text-sm font-medium text-amber-900 dark:bg-amber-950 dark:text-amber-200"
      >
        Нет сети. Расходы сохранятся на устройстве и отправятся, когда связь появится
      </div>
    );
  }
  if (restored) {
    return (
      <div
        role="status"
        className="mb-4 rounded-xl bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200"
      >
        Связь восстановлена. Отправляю расходы…
      </div>
    );
  }
  return null;
}

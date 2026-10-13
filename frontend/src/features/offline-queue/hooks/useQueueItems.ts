import { useEffect, useState } from 'react';
import { queueStore } from '../model/queue-store.ts';
import { queueVersion, subscribeQueue } from '../model/queue-signal.ts';
import type { QueuedExpense } from '../model/queue-types.ts';
import { useSyncExternalStore } from 'react';

/** What is in the queue now; refreshed whenever the queue changes. */
export function useQueueItems(): QueuedExpense[] {
  const version = useSyncExternalStore(subscribeQueue, queueVersion, queueVersion);
  const [items, setItems] = useState<QueuedExpense[]>([]);

  useEffect(() => {
    let current = true;
    queueStore
      .list()
      // An unavailable storage means an empty queue: nothing could have been put in it
      .catch(() => [] as QueuedExpense[])
      .then((list) => current && setItems(list));
    return () => {
      current = false;
    };
  }, [version]);

  return items;
}

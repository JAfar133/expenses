import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect } from 'react';
import { invalidateAfterCreate } from '../../expenses/hooks/useCreateExpense.ts';
import { announceAllSent, onQueueSyncRequested } from '../model/queue-signal.ts';
import { queueStore } from '../model/queue-store.ts';
import { runQueueSync } from '../model/queue-sync.ts';
import { useQueueItems } from './useQueueItems.ts';

export const SYNC_INTERVAL_MS = 30_000;

/**
 * Sends the queue of offline expenses: on start, when the network is back, when the app becomes visible again
 * and every 30 seconds while something waits. After a send the lists and totals are refreshed.
 */
export function useQueueSync(): void {
  const queryClient = useQueryClient();
  const waiting = useQueueItems().some((item) => item.status === 'pending');

  const run = useCallback(async () => {
    const outcome = await runQueueSync();
    if (!outcome || outcome.created === 0) return;
    invalidateAfterCreate(queryClient);
    const left = await queueStore.list().catch(() => []);
    if (left.length === 0) announceAllSent();
  }, [queryClient]);

  useEffect(() => {
    void run();
    const onVisible = () => {
      if (document.visibilityState === 'visible') void run();
    };
    const onOnline = () => void run();
    window.addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', onVisible);
    const unsubscribe = onQueueSyncRequested(() => void run());
    return () => {
      window.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', onVisible);
      unsubscribe();
    };
  }, [run]);

  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => void run(), SYNC_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [waiting, run]);
}

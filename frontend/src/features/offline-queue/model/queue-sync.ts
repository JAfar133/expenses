import { ApiError, NETWORK_ERROR_CODE } from '../../../shared/api/http.ts';
import { isBrowserOnline } from '../../../shared/hooks/useOnlineStatus.ts';
import { createExpense } from '../../expenses/api/expenses.api.ts';
import { toSaveErrorMessage } from '../../expenses/api/save-error-message.ts';
import { uploadReceipt } from '../../receipts/api/receipts.api.ts';
import { queueStore } from './queue-store.ts';
import { setSending, setSyncing } from './queue-signal.ts';
import type { QueuedExpense, QueueStore } from './queue-types.ts';

/** What to do with a failed request. */
export type ErrorKind = 'retry' | 'auth' | 'reject';

/**
 * retry: no answer, a gateway problem, too many requests or a server fault: try later, the record stays;
 * auth: the session is gone: stop and touch nothing;
 * reject: the server looked at the expense and refused it: no point in resending.
 */
export function classifyError(error: unknown): ErrorKind {
  if (!(error instanceof ApiError)) return 'retry';
  if (error.code === NETWORK_ERROR_CODE || error.status === 0) return 'retry';
  if (error.status === 401) return 'auth';
  if (error.status === 429 || error.status === 408 || error.status >= 500) return 'retry';
  return 'reject';
}

/** Can the failed save be put into the queue instead of being shown as an error (no answer or a gateway error). */
export function isQueueable(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    (error.code === NETWORK_ERROR_CODE || [0, 502, 503, 504].includes(error.status))
  );
}

export interface SyncDeps {
  store: QueueStore;
  send: typeof createExpense;
  uploadPhoto: typeof uploadReceipt;
}

export interface SyncOutcome {
  /** How many expenses the server accepted during this run (their photos may still have failed) */
  created: number;
  stoppedBy?: 'retry' | 'auth';
}

const PHOTO_FAILED_MESSAGE = 'Расход отправлен, но фото не загрузилось';

/** Sends the pending records one by one, oldest first. A network problem or a lost session stops the run. */
export async function syncOnce(deps: SyncDeps): Promise<SyncOutcome> {
  const outcome: SyncOutcome = { created: 0 };
  const items = (await deps.store.list()).filter((item) => item.status === 'pending');

  for (const item of items) {
    setSending(item.id);
    const stop = await sendOne(item, deps, outcome);
    if (stop) {
      outcome.stoppedBy = stop;
      break;
    }
  }
  return outcome;
}

/** One record; returns why the whole run must stop, if it must. */
async function sendOne(
  item: QueuedExpense,
  { store, send, uploadPhoto }: SyncDeps,
  outcome: SyncOutcome,
): Promise<'retry' | 'auth' | undefined> {
  await store.update(item.id, { attempts: item.attempts + 1 });
  let serverId = item.serverId;

  if (!serverId) {
    try {
      // The same idempotency key on every attempt: a repeat never creates a duplicate
      serverId = (await send(item.expense, item.id)).id;
      outcome.created += 1;
      await store.update(item.id, { serverId });
    } catch (error) {
      const kind = classifyError(error);
      if (kind !== 'reject') return kind;
      await store.update(item.id, { status: 'failed', error: toSaveErrorMessage(error) });
      return undefined;
    }
  }

  if (item.photo) {
    try {
      await uploadPhoto(serverId, item.photo);
    } catch (error) {
      const kind = classifyError(error);
      if (kind !== 'reject') return kind;
      // The expense is saved: keep the record only for a manual retry of the photo
      await store.update(item.id, {
        status: 'failed',
        error: PHOTO_FAILED_MESSAGE,
        photoFailed: true,
      });
      return undefined;
    }
  }

  await store.remove(item.id);
  return undefined;
}

const defaultDeps: SyncDeps = {
  store: queueStore,
  send: createExpense,
  uploadPhoto: uploadReceipt,
};

let running = false;

/** Two tabs must not send at the same time: a Web Lock where the browser has it. */
async function withTabLock<T>(run: () => Promise<T>): Promise<T | undefined> {
  const locks = typeof navigator === 'undefined' ? undefined : navigator.locks;
  if (!locks?.request) return run();
  return locks.request('expenses-queue-sync', { ifAvailable: true }, (lock) =>
    lock ? run() : Promise.resolve(undefined),
  );
}

/** One sync run; a run that is already in progress (here or in another tab) makes this call do nothing. */
export async function runQueueSync(deps: SyncDeps = defaultDeps): Promise<SyncOutcome | undefined> {
  if (running || !isBrowserOnline()) return undefined;
  running = true;
  setSyncing(true);
  try {
    return await withTabLock(() => syncOnce(deps));
  } catch {
    // The storage is unavailable: nothing to send
    return undefined;
  } finally {
    running = false;
    setSending(undefined);
    setSyncing(false);
  }
}

/** For tests: forget a run that never finished. */
export function resetQueueSyncState(): void {
  running = false;
}

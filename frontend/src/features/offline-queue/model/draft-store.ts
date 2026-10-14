import type { FormDraftData } from '../../expenses/model/form-draft.ts';
import { fromStoredBlob, toStoredBlob, type StoredBlob } from './blob-bytes.ts';

const DB_NAME = 'expenses-form-draft';
const STORE = 'drafts';

/** The parse id of a draft lives on the server for a day: an older draft is dropped. */
export const DRAFT_TTL_MS = 24 * 60 * 60 * 1000;

type StoredDraft = {
  /** The user: a draft is never shown to somebody else */
  user: string;
  savedAt: number;
  data: Omit<FormDraftData, 'photo'> & { photo?: StoredBlob };
};

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('no IndexedDB'));
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB_NAME, 1);
    } catch (error) {
      return reject(error);
    }
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'user' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('blocked'));
  });
}

const inflight = new Set<Promise<unknown>>();

/** For tests: waits until the writes under way are done (before the storage is replaced). */
export const settleDraftWrites = () => Promise.all([...inflight]);

function track<T>(promise: Promise<T>): Promise<T> {
  inflight.add(promise);
  void promise.finally(() => inflight.delete(promise));
  return promise;
}

async function run<T>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const database = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = database.transaction(STORE, mode);
      const request = action(transaction.objectStore(STORE));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    database.close();
  }
}

/** Saves the draft of the user (one per user). A storage that does not work is not an error for the form. */
export function saveDraft(user: string, data: FormDraftData, now = Date.now()): Promise<void> {
  return track(write(user, data, now));
}

async function write(user: string, data: FormDraftData, now: number): Promise<void> {
  try {
    const { photo, ...rest } = data;
    const record: StoredDraft = {
      user,
      savedAt: now,
      data: { ...rest, ...(photo ? { photo: await toStoredBlob(photo) } : {}) },
    };
    await run('readwrite', (store) => store.put(record));
  } catch {
    // The draft is a convenience: without storage the form simply works as before
  }
}

export async function clearDraft(user: string): Promise<void> {
  try {
    await track(run('readwrite', (store) => store.delete(user)));
  } catch {
    // See above
  }
}

/** Sign-out: no draft stays on the device. */
export async function clearAllDrafts(): Promise<void> {
  try {
    await run('readwrite', (store) => store.clear());
  } catch {
    // See above
  }
}

/** The draft of the user if it is younger than a day; an older one is deleted. */
export async function loadDraft(
  user: string,
  now = Date.now(),
): Promise<{ data: FormDraftData; savedAt: number } | null> {
  try {
    const record = await run<StoredDraft | undefined>('readonly', (store) => store.get(user));
    if (!record || record.user !== user) return null;
    if (now - record.savedAt > DRAFT_TTL_MS) {
      await clearDraft(user);
      return null;
    }
    const { photo, ...rest } = record.data;
    return {
      savedAt: record.savedAt,
      data: { ...rest, ...(photo ? { photo: fromStoredBlob(photo) } : {}) },
    };
  } catch {
    return null;
  }
}

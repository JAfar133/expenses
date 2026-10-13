import { QueueUnavailableError, type QueuedExpense, type QueueStore } from './queue-types.ts';
import { notifyQueueChanged } from './queue-signal.ts';

/** How a record lies in IndexedDB: the photo as bytes (Safari is unreliable with Blobs in IndexedDB). */
type StoredExpense = Omit<QueuedExpense, 'photo'> & {
  photo?: { bytes: ArrayBuffer; type: string };
};

function readBytes(blob: Blob): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(new QueueUnavailableError());
    reader.readAsArrayBuffer(blob);
  });
}

async function toStored({ photo, ...rest }: QueuedExpense): Promise<StoredExpense> {
  return photo ? { ...rest, photo: { bytes: await readBytes(photo), type: photo.type } } : rest;
}

function fromStored({ photo, ...rest }: StoredExpense): QueuedExpense {
  return photo ? { ...rest, photo: new Blob([photo.bytes], { type: photo.type }) } : rest;
}

const DB_NAME = 'expenses-offline-queue';
const STORE = 'expenses';

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new QueueUnavailableError());
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB_NAME, 1);
    } catch {
      return reject(new QueueUnavailableError());
    }
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    // A private mode or a blocked storage: the open fails
    request.onerror = () => reject(new QueueUnavailableError());
    request.onblocked = () => reject(new QueueUnavailableError());
  });
}

/** Runs one transaction: the connection is opened for the call and closed after it (nothing is cached). */
async function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const database = await openDatabase();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = database.transaction(STORE, mode);
      const request = run(transaction.objectStore(STORE));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = () => reject(new QueueUnavailableError());
      transaction.onabort = () => reject(new QueueUnavailableError());
    });
  } catch (error) {
    throw error instanceof QueueUnavailableError ? error : new QueueUnavailableError();
  } finally {
    database.close();
  }
}

/** Is the storage usable at all (for a clear message instead of a silent loss). */
export async function isQueueAvailable(): Promise<boolean> {
  try {
    (await openDatabase()).close();
    return true;
  } catch {
    return false;
  }
}

/** The queue in IndexedDB. */
export const queueStore: QueueStore = {
  async add(item) {
    const stored = await toStored(item);
    await withStore('readwrite', (store) => store.add(stored));
    notifyQueueChanged();
  },

  async list() {
    const items = await withStore(
      'readonly',
      (store) => store.getAll() as IDBRequest<StoredExpense[]>,
    );
    return items.map(fromStored).sort((a, b) => a.createdAt - b.createdAt);
  },

  async update(id, patch) {
    const database = await openDatabase();
    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction(STORE, 'readwrite');
        const store = transaction.objectStore(STORE);
        const read = store.get(id);
        read.onsuccess = () => {
          // The record may be gone already (removed by the user): nothing to update
          if (read.result) store.put({ ...read.result, ...patch, id });
        };
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(new QueueUnavailableError());
        transaction.onabort = () => reject(new QueueUnavailableError());
      });
    } finally {
      database.close();
    }
    notifyQueueChanged();
  },

  async remove(id) {
    await withStore('readwrite', (store) => store.delete(id));
    notifyQueueChanged();
  },
};

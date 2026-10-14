import 'fake-indexeddb/auto';
import '@testing-library/jest-dom/vitest';
import { IDBFactory } from 'fake-indexeddb';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';
import { clearPendingPhoto } from '../src/features/receipts/model/pending-photo.ts';
import { resetNetworkState } from '../src/shared/api/network-state.ts';
import { resetQueueSignals } from '../src/features/offline-queue/model/queue-signal.ts';
import { settleDraftWrites } from '../src/features/offline-queue/model/draft-store.ts';
import { resetQueueSyncState } from '../src/features/offline-queue/model/queue-sync.ts';
import { setAppTimezone } from '../src/shared/utils/date.ts';

afterEach(async () => {
  cleanup();
  // A draft being written must land in the storage of its own test
  await settleDraftWrites();
  localStorage.clear();
  setAppTimezone(undefined);
  // A fresh empty device storage and no leftover network state for the next test
  globalThis.indexedDB = new IDBFactory();
  resetNetworkState();
  clearPendingPhoto();
  resetQueueSignals();
  resetQueueSyncState();
});

// Recharts observes container size; jsdom has no ResizeObserver
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver;

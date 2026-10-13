import 'fake-indexeddb/auto';
import '@testing-library/jest-dom/vitest';
import { IDBFactory } from 'fake-indexeddb';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';
import { resetNetworkState } from '../src/shared/api/network-state.ts';
import { resetQueueSignals } from '../src/features/offline-queue/model/queue-signal.ts';
import { resetQueueSyncState } from '../src/features/offline-queue/model/queue-sync.ts';
import { setAppTimezone } from '../src/shared/utils/date.ts';

afterEach(() => {
  cleanup();
  localStorage.clear();
  setAppTimezone(undefined);
  // A fresh empty device storage and no leftover network state for the next test
  globalThis.indexedDB = new IDBFactory();
  resetNetworkState();
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

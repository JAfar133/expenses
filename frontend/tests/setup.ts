import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';
import { setAppTimezone } from '../src/shared/utils/date.ts';

afterEach(() => {
  cleanup();
  localStorage.clear();
  setAppTimezone(undefined);
});

// Recharts observes container size; jsdom has no ResizeObserver
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver;

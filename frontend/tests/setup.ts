import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';
import { setAppTimezone } from '../src/shared/utils/date.ts';

afterEach(() => {
  cleanup();
  localStorage.clear();
  setAppTimezone(undefined);
});

// Recharts следит за размером контейнера; в jsdom ResizeObserver нет
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver;

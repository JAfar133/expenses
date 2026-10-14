import { useSyncExternalStore } from 'react';

/**
 * A photo taken with the camera button on a page other than «Добавить»: a File cannot travel in a URL, so it waits
 * here until the form takes it (the form clears it right away). It survives re-renders and the move to the page.
 */
let pending: Blob | null = null;
const listeners = new Set<() => void>();

const notify = () => listeners.forEach((listener) => listener());

export function setPendingPhoto(photo: Blob): void {
  pending = photo;
  notify();
}

export function clearPendingPhoto(): void {
  if (pending === null) return;
  pending = null;
  notify();
}

export const usePendingPhoto = () =>
  useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => pending,
    () => null,
  );

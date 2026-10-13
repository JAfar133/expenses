import { useSyncExternalStore } from 'react';
import { hasNetworkFailure, reportNetwork, subscribeNetwork } from '../api/network-state.ts';

function subscribe(listener: () => void) {
  if (typeof window === 'undefined') return () => undefined;
  const onOnline = () => {
    // The browser says the network is back: forget the old request failure
    reportNetwork(true);
    listener();
  };
  window.addEventListener('online', onOnline);
  window.addEventListener('offline', listener);
  const unsubscribeNetwork = subscribeNetwork(listener);
  return () => {
    window.removeEventListener('online', onOnline);
    window.removeEventListener('offline', listener);
    unsubscribeNetwork();
  };
}

/** The browser's own flag: false only when it is sure there is no network. */
export const isBrowserOnline = () => typeof navigator === 'undefined' || navigator.onLine !== false;

const getSnapshot = () => isBrowserOnline() && !hasNetworkFailure();

/** Is there a network: `navigator.onLine`, the online/offline events and failed requests without a response. */
export function useOnlineStatus(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => true);
}

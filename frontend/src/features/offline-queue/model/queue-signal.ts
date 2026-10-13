import { useSyncExternalStore } from 'react';

/** The queue lives in IndexedDB, so the UI is told about changes through this small channel. */
const changeListeners = new Set<() => void>();
let version = 0;

export function notifyQueueChanged(): void {
  version += 1;
  changeListeners.forEach((listener) => listener());
}

export const subscribeQueue = (listener: () => void) => {
  changeListeners.add(listener);
  return () => changeListeners.delete(listener);
};

export const queueVersion = () => version;

/** State of the sender: which record is being sent now, and the short "all sent" announcement. */
interface SenderState {
  sendingId: string | undefined;
  syncing: boolean;
  allSent: boolean;
}
let sender: SenderState = { sendingId: undefined, syncing: false, allSent: false };
const senderListeners = new Set<() => void>();
let allSentTimer: ReturnType<typeof setTimeout> | undefined;

export const ALL_SENT_VISIBLE_MS = 4000;

function setSender(patch: Partial<SenderState>) {
  sender = { ...sender, ...patch };
  senderListeners.forEach((listener) => listener());
}

export const setSending = (sendingId: string | undefined) => setSender({ sendingId });
export const setSyncing = (syncing: boolean) => setSender({ syncing });

export function announceAllSent(): void {
  clearTimeout(allSentTimer);
  setSender({ allSent: true });
  allSentTimer = setTimeout(() => setSender({ allSent: false }), ALL_SENT_VISIBLE_MS);
}

export const clearAllSent = () => {
  clearTimeout(allSentTimer);
  if (sender.allSent) setSender({ allSent: false });
};

const subscribeSender = (listener: () => void) => {
  senderListeners.add(listener);
  return () => senderListeners.delete(listener);
};

export const useSenderState = () => useSyncExternalStore(subscribeSender, () => sender);

/** For tests. */
export function resetQueueSignals(): void {
  clearTimeout(allSentTimer);
  changeListeners.clear();
  syncRequestListeners.clear();
  senderListeners.clear();
  version = 0;
  sender = { sendingId: undefined, syncing: false, allSent: false };
}

/** "Send now": after «Повторить», a returned connection and so on. */
const syncRequestListeners = new Set<() => void>();

export const requestQueueSync = () => syncRequestListeners.forEach((listener) => listener());

export const onQueueSyncRequested = (listener: () => void) => {
  syncRequestListeners.add(listener);
  return () => syncRequestListeners.delete(listener);
};

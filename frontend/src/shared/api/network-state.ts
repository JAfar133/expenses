/**
 * A weak "no network" signal from the requests themselves: `fetch` threw without any response.
 * It works even when `navigator.onLine` says true (a captive portal, a dead connection).
 */
let failed = false;
const listeners = new Set<() => void>();

export function reportNetwork(reachable: boolean): void {
  if (failed === !reachable) return;
  failed = !reachable;
  listeners.forEach((listener) => listener());
}

export const subscribeNetwork = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const hasNetworkFailure = () => failed;

/** For tests. */
export function resetNetworkState(): void {
  failed = false;
  listeners.clear();
}

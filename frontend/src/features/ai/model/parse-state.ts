import { useSyncExternalStore } from 'react';

/** Receipts being parsed right now, and the outcome of the last parse: a calm status, not a blocking dialog. */
export interface ParseState {
  running: readonly string[];
  last?: { kind: 'ok' | 'error'; message: string };
}

let state: ParseState = { running: [] };
const listeners = new Set<() => void>();

function update(next: ParseState) {
  state = next;
  listeners.forEach((listener) => listener());
}

export const beginParse = (expenseId: string) =>
  update({ ...state, running: [...state.running.filter((id) => id !== expenseId), expenseId] });

export const endParse = (expenseId: string, last: ParseState['last']) =>
  update({ running: state.running.filter((id) => id !== expenseId), last });

export const dismissParseResult = () => update({ ...state, last: undefined });

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const useParseState = () => useSyncExternalStore(subscribe, () => state);
export const useIsParsing = (expenseId: string) => useParseState().running.includes(expenseId);

/** For tests. */
export function resetParseState() {
  listeners.clear();
  state = { running: [] };
}

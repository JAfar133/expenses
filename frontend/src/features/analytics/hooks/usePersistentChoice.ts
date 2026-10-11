import { useCallback, useState } from 'react';
import { readStored, writeStored } from '../../../shared/utils/storage.ts';

/** Выбор из фиксированного списка, который запоминается на устройстве (например, вид графика). */
export function usePersistentChoice<T extends string>(
  key: string,
  allowed: readonly T[],
  fallback: T,
): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => {
    const stored = readStored(`analytics.${key}`);
    return allowed.includes(stored as T) ? (stored as T) : fallback;
  });

  const choose = useCallback(
    (next: T) => {
      setValue(next);
      writeStored(`analytics.${key}`, next);
    },
    [key],
  );
  return [value, choose];
}

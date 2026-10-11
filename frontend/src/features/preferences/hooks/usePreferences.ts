import { useMutation, useMutationState, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { readStored, writeStored } from '../../../shared/utils/storage.ts';
import { fetchPreferences, savePreferences } from '../api/preferences.api.ts';
import {
  isAllowed,
  PREFERENCE_KEYS,
  PREFERENCES,
  sanitizePreferences,
  type PreferenceKey,
  type PreferenceValue,
  type Preferences,
} from '../model/preferences.ts';

export const PREFERENCES_KEY = ['preferences'];
const SAVE_KEY = ['preferences', 'save'];

/** Прежнее место хранения (браузер): оно остаётся быстрым кэшем и источником для переноса на сервер. */
const localKey = (key: PreferenceKey) => `analytics.${key}`;

const readLocal = (key: PreferenceKey): string | undefined => {
  const value = readStored(localKey(key));
  return isAllowed(key, value) ? value : undefined;
};

/**
 * Загружает настройки пользователя с сервера. Выборы, которые раньше сохранялись только в браузере,
 * один раз переносятся на сервер: так ничего не теряется при переходе.
 */
async function loadPreferences(): Promise<Preferences> {
  const server = await fetchPreferences();
  const missing: Record<string, string> = {};
  for (const key of PREFERENCE_KEYS) {
    const local = readLocal(key);
    if (server[key] === undefined && local !== undefined) missing[key] = local;
  }
  if (Object.keys(missing).length === 0) return server;

  // Не удалось перенести: не страшно, значения останутся в браузере и перенесутся в следующий раз
  const merged = await savePreferences(missing as Preferences).catch(() => undefined);
  return merged ?? { ...server, ...(missing as Preferences) };
}

/** Настройки пользователя. Пока не загрузились (или сервер недоступен), используются значения из браузера. */
export function usePreferences() {
  return useQuery({
    queryKey: PREFERENCES_KEY,
    queryFn: loadPreferences,
    staleTime: Infinity,
    retry: false,
  });
}

/** Запись настроек: сразу в интерфейс и в браузер, затем на сервер (при ошибке выбор не теряется). */
export function useSavePreferences() {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationKey: SAVE_KEY,
    retry: false,
    mutationFn: savePreferences,
    onSuccess: (saved) => queryClient.setQueryData(PREFERENCES_KEY, saved),
  });

  const save = useCallback(
    (patch: Preferences) => {
      for (const key of PREFERENCE_KEYS) {
        const value = patch[key];
        if (value !== undefined) writeStored(localKey(key), value);
      }
      queryClient.setQueryData<Preferences>(PREFERENCES_KEY, (current) => ({
        ...(current ?? {}),
        ...sanitizePreferences(patch),
      }));
      return mutation.mutateAsync(patch).catch(() => undefined);
    },
    [mutation, queryClient],
  );

  return { save };
}

/**
 * Состояние последнего сохранения настроек на сервер. Мутации создаёт каждый компонент отдельно,
 * поэтому статус берётся из общего журнала мутаций: так он виден везде, где его показывают.
 */
export function useSaveStatus(): { isSaving: boolean; isError: boolean } {
  const statuses = useMutationState({
    filters: { mutationKey: SAVE_KEY },
    select: (mutation) => mutation.state.status,
  });
  const latest = statuses.at(-1);
  return { isSaving: latest === 'pending', isError: latest === 'error' };
}

/** Значение одной настройки и способ её изменить: сервер, затем браузер, затем значение по умолчанию. */
export function usePreference<K extends PreferenceKey>(
  key: K,
): [PreferenceValue<K>, (value: PreferenceValue<K>) => void] {
  const { data } = usePreferences();
  const { save } = useSavePreferences();

  const stored = data?.[key];
  const value = (stored ?? readLocal(key) ?? PREFERENCES[key].fallback) as PreferenceValue<K>;

  const change = useCallback(
    (next: PreferenceValue<K>) => void save({ [key]: next } as Preferences),
    [key, save],
  );
  return [value, change];
}

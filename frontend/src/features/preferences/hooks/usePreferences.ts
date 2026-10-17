import { useMutation, useMutationState, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { readStored, writeStored } from '../../../shared/utils/storage.ts';
import { fetchPreferences, savePreferences } from '../api/preferences.api.ts';
import {
  isAllowed,
  migrateLegacy,
  PREFERENCE_KEYS,
  PREFERENCES,
  sanitizePreferences,
  type BooleanPreferenceKey,
  type PreferenceKey,
  type PreferenceValue,
  type Preferences,
} from '../model/preferences.ts';

export const PREFERENCES_KEY = ['preferences'];
const SAVE_KEY = ['preferences', 'save'];

/** Former storage location (browser): stays as a fast cache and a source for migration to the server. */
const localKey = (key: PreferenceKey) => `analytics.${key}`;

const readLocal = (key: PreferenceKey): string | undefined => {
  const value = migrateLegacy(key, readStored(localKey(key)));
  return isAllowed(key, value) ? value : undefined;
};

/**
 * Loads user preferences from the server. Choices that used to be saved only in the browser
 * are migrated to the server once, so nothing is lost during the transition.
 */
async function loadPreferences(): Promise<Preferences> {
  const server = await fetchPreferences();
  const missing: Record<string, string> = {};
  for (const key of PREFERENCE_KEYS) {
    const local = readLocal(key);
    if (server[key] === undefined && local !== undefined) missing[key] = local;
  }
  if (Object.keys(missing).length === 0) return server;

  // Migration failed: not a problem, values stay in the browser and migrate next time
  const merged = await savePreferences(missing as Preferences).catch(() => undefined);
  return merged ?? { ...server, ...(missing as Preferences) };
}

/** User preferences. Until loaded (or if the server is unavailable), browser values are used. */
export function usePreferences() {
  return useQuery({
    queryKey: PREFERENCES_KEY,
    queryFn: loadPreferences,
    staleTime: Infinity,
    retry: false,
  });
}

/** Saves preferences: to the UI and browser immediately, then to the server (the choice is kept on error). */
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
 * Status of the last preferences save to the server. Each component creates its own mutations,
 * so the status comes from the shared mutation log: it is visible everywhere it is shown.
 */
export function useSaveStatus(): { isSaving: boolean; isError: boolean } {
  const statuses = useMutationState({
    filters: { mutationKey: SAVE_KEY },
    select: (mutation) => mutation.state.status,
  });
  const latest = statuses.at(-1);
  return { isSaving: latest === 'pending', isError: latest === 'error' };
}

/** Value of a single preference and a way to change it: server, then browser, then default. */
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

/** The user's explicit choice of a preference, or undefined if they never chose (the default is not a choice). */
export function useChosenPreference<K extends PreferenceKey>(
  key: K,
): PreferenceValue<K> | undefined {
  const { data } = usePreferences();
  return (data?.[key] ?? readLocal(key)) as PreferenceValue<K> | undefined;
}

/** A yes/no preference and a way to change it; until the user chooses, `fallback` is the value. */
export function useBooleanPreference(
  key: BooleanPreferenceKey,
  fallback: boolean,
): [boolean, (value: boolean) => void] {
  const { data } = usePreferences();
  const { save } = useSavePreferences();
  const change = useCallback((next: boolean) => void save({ [key]: next }), [key, save]);
  return [data?.[key] ?? fallback, change];
}

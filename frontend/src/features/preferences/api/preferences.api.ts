import { apiRequest } from '../../../shared/api/http.ts';
import { sanitizePreferences, type Preferences } from '../model/preferences.ts';

export const fetchPreferences = async (): Promise<Preferences> =>
  sanitizePreferences((await apiRequest<unknown>('/preferences')).data);

/** Changes only the given preferences; returns the resulting set. */
export const savePreferences = async (patch: Preferences): Promise<Preferences> =>
  sanitizePreferences(
    (await apiRequest<unknown>('/preferences', { method: 'PUT', body: JSON.stringify(patch) }))
      .data,
  );

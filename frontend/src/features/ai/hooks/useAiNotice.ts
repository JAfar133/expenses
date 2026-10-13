import { usePreferences, useSavePreferences } from '../../preferences/hooks/usePreferences.ts';

/** The one-time notice that a receipt photo goes to Google: was it confirmed, and a way to confirm. */
export function useAiNotice() {
  const preferences = usePreferences();
  const { save } = useSavePreferences();
  return {
    // Until the preferences are loaded nothing is decided (no flash for those who already confirmed)
    ready: !preferences.isPending,
    seen: preferences.data?.['ai.noticeSeen'] === true,
    confirm: () => void save({ 'ai.noticeSeen': true }),
  };
}

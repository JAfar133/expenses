import { useSavePreferences, usePreferences } from '../../preferences/hooks/usePreferences.ts';
import { useAiAvailable } from '../hooks/useAiStatus.ts';

/** Shown once, when the first receipt photo is attached: where the photo goes. */
export function AiNotice() {
  const available = useAiAvailable();
  const { data } = usePreferences();
  const { save } = useSavePreferences();
  // Until the preferences are loaded nothing is shown (no flash for those who already confirmed)
  if (!available || !data || data['ai.noticeSeen'] === true) return null;

  return (
    <div
      role="note"
      className="flex items-center justify-between gap-3 rounded-xl bg-violet-50 px-3 py-2 text-sm text-violet-900 dark:bg-violet-950/50 dark:text-violet-200"
    >
      <span>Чек будет отправлен на разбор в Google (Gemini)</span>
      <button
        type="button"
        onClick={() => void save({ 'ai.noticeSeen': true })}
        className="h-9 shrink-0 rounded-lg bg-violet-600 px-3 text-sm font-medium text-white hover:bg-violet-500"
      >
        Понятно
      </button>
    </div>
  );
}

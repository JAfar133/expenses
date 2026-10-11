import { ChartTypeSwitch } from '../../analytics/components/ChartTypeSwitch.tsx';
import {
  usePreference,
  useSavePreferences,
  useSaveStatus,
} from '../../preferences/hooks/usePreferences.ts';
import {
  defaultPreferences,
  PREFERENCE_KEYS,
  PREFERENCES,
  type PreferenceKey,
} from '../../preferences/model/preferences.ts';
import { SettingsSection } from './SettingsSection.tsx';

/** Одна настройка: название, пояснение и переключатель. Выбор сразу сохраняется на сервере. */
function PreferenceRow({ prefKey }: { prefKey: PreferenceKey }) {
  const definition = PREFERENCES[prefKey];
  const [value, change] = usePreference(prefKey);

  return (
    <div className="space-y-2">
      <div>
        <div className="text-sm font-medium">{definition.label}</div>
        {'description' in definition && definition.description && (
          <div className="text-sm text-zinc-500 dark:text-zinc-400">{definition.description}</div>
        )}
      </div>
      <ChartTypeSwitch<string>
        label={definition.label}
        options={definition.options}
        value={value}
        mobileColumns={definition.options.length <= 2 ? 2 : definition.options.length === 3 ? 3 : 4}
        onChange={(next) => (change as (value: string) => void)(next)}
      />
    </div>
  );
}

/** Как показывать анализ по умолчанию: виды графиков и панель фильтров. */
export function AnalyticsSection() {
  const { save } = useSavePreferences();
  const { isSaving, isError } = useSaveStatus();

  return (
    <SettingsSection
      title="Анализ"
      description="Выбор запоминается для вашего аккаунта и действует на всех устройствах"
    >
      <div className="space-y-5">
        {PREFERENCE_KEYS.map((key) => (
          <PreferenceRow key={key} prefKey={key} />
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3 pt-1">
        <button
          type="button"
          onClick={() => void save(defaultPreferences())}
          disabled={isSaving}
          className="h-10 rounded-xl border border-zinc-300 px-4 text-sm font-medium hover:border-indigo-400 disabled:opacity-60 dark:border-zinc-700"
        >
          Сбросить к стандартным
        </button>
        {isError && (
          <span role="alert" className="text-sm text-red-600 dark:text-red-400">
            Не удалось сохранить на сервере: выбор сохранён только в этом браузере
          </span>
        )}
      </div>
    </SettingsSection>
  );
}

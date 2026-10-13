import { ChartTypeSwitch } from '../../analytics/components/ChartTypeSwitch.tsx';
import { usePreference } from '../../preferences/hooks/usePreferences.ts';
import { PREFERENCES, type PreferenceKey } from '../../preferences/model/preferences.ts';

/** The label of the option chosen now for a preference. */
export function usePreferenceLabel(prefKey: PreferenceKey): string {
  const [value] = usePreference(prefKey);
  return PREFERENCES[prefKey].options.find((option) => option.value === value)?.label ?? '';
}

/** One setting: a title and a segmented switch; the choice is saved to the server at once. */
export function PreferenceSwitch({ prefKey, label }: { prefKey: PreferenceKey; label: string }) {
  const definition = PREFERENCES[prefKey];
  const [value, change] = usePreference(prefKey);

  return (
    <div className="space-y-2">
      <div className="text-sm font-medium">{label}</div>
      <ChartTypeSwitch<string>
        label={label}
        options={definition.options}
        value={value}
        mobileColumns={definition.options.length <= 2 ? 2 : definition.options.length === 3 ? 3 : 4}
        onChange={(next) => (change as (value: string) => void)(next)}
      />
    </div>
  );
}

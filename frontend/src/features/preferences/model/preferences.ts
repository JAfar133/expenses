/**
 * UI preferences remembered per user. One definition for the whole app:
 * used by the charts themselves (allowed values, labels) and by the settings page.
 * Keys and values must match what the server accepts (`preferences.schema.ts`).
 */
export interface PreferenceOption<V extends string> {
  value: V;
  label: string;
}

interface PreferenceDefinition<V extends string> {
  /** Preference title on the settings page */
  label: string;
  /** Description under the title */
  description?: string;
  /** Value until the user chooses anything */
  fallback: V;
  options: readonly PreferenceOption<V>[];
}

const define = <V extends string>(definition: PreferenceDefinition<V>) => definition;

export const PREFERENCES = {
  'daily.type': define({
    label: 'График по времени',
    description: 'Как показывать расходы по дням, неделям и месяцам',
    fallback: 'bars',
    options: [
      { value: 'bars', label: 'Столбики' },
      { value: 'line', label: 'Линия' },
      { value: 'area', label: 'Область' },
    ],
  }),
  'daily.mode': define({
    label: 'Что показывать на графике по времени',
    fallback: 'daily',
    options: [
      { value: 'daily', label: 'За день' },
      { value: 'cumulative', label: 'Накопительно' },
    ],
  }),
  'category.type': define({
    label: 'Расход по категориям',
    fallback: 'donut',
    options: [
      { value: 'bars', label: 'Полосы' },
      { value: 'donut', label: 'Кольцо' },
      { value: 'pie', label: 'Круг' },
    ],
  }),
  'category.tab': define({
    label: 'Категории: раздел',
    description: 'Что показывать в карточке «Расход по категориям», если в группе есть лимиты',
    fallback: 'limits',
    options: [
      { value: 'limits', label: 'Бюджет и лимиты' },
      { value: 'structure', label: 'Структура расходов' },
    ],
  }),
  'matrix.type': define({
    label: 'Категории по месяцам',
    fallback: 'stacked',
    options: [
      { value: 'stacked', label: 'С накоплением' },
      { value: 'lines', label: 'Линии' },
    ],
  }),
  'compare.months': define({
    label: 'Сравнение месяцев: за сколько месяцев',
    fallback: '12',
    options: [
      { value: '6', label: '6 мес.' },
      { value: '12', label: '12 мес.' },
      { value: '24', label: '24 мес.' },
    ],
  }),
  theme: define({
    label: 'Тема',
    description: 'Оформление приложения на этом устройстве и на остальных',
    fallback: 'system',
    options: [
      { value: 'system', label: 'Системная' },
      { value: 'light', label: 'Светлая' },
      { value: 'dark', label: 'Тёмная' },
    ],
  }),
  'analytics.currency': define({
    label: 'Валюта на странице анализа',
    description: 'Суммы хранятся в драммах и пересчитываются по текущему курсу ЦБ Армении',
    fallback: 'AMD',
    options: [
      { value: 'AMD', label: '🇦🇲 AMD' },
      { value: 'RUB', label: '🇷🇺 RUB' },
      { value: 'USD', label: '🇺🇸 USD' },
      { value: 'EUR', label: '🇪🇺 EUR' },
    ],
  }),
} as const;

export type PreferenceKey = keyof typeof PREFERENCES;
export type PreferenceValue<K extends PreferenceKey> =
  (typeof PREFERENCES)[K]['options'][number]['value'];

export const PREFERENCE_KEYS = Object.keys(PREFERENCES) as PreferenceKey[];

/** Flags that are plain booleans, not a choice from a list: kept apart from `PREFERENCES`. */
export const BOOLEAN_PREFERENCES = ['ai.noticeSeen'] as const;
export type BooleanPreferenceKey = (typeof BOOLEAN_PREFERENCES)[number];

/** All saved preferences: only those the user changed. */
export type Preferences = { [K in PreferenceKey]?: PreferenceValue<K> } & {
  /** The person has seen the notice that a receipt photo is sent to the AI service */
  [K in BooleanPreferenceKey]?: boolean;
};

export const isAllowed = <K extends PreferenceKey>(
  key: K,
  value: unknown,
): value is PreferenceValue<K> => PREFERENCES[key].options.some((option) => option.value === value);

/** Default values for all preferences. */
export const defaultPreferences = (): Preferences =>
  Object.fromEntries(PREFERENCE_KEYS.map((key) => [key, PREFERENCES[key].fallback])) as Preferences;

/** Values that no longer exist and what they became: an old saved choice keeps working. */
const LEGACY_VALUES: Partial<Record<PreferenceKey, Record<string, string>>> = {
  'category.type': { columns: 'bars' },
};

/** A removed value is replaced by its successor; everything else is returned as is. */
export const migrateLegacy = (key: PreferenceKey, value: unknown): unknown =>
  typeof value === 'string' ? (LEGACY_VALUES[key]?.[value] ?? value) : value;

/** Keeps only known keys with allowed values: server responses and old records are not trusted blindly. */
export function sanitizePreferences(raw: unknown): Preferences {
  const clean: Record<string, string | boolean> = {};
  if (raw && typeof raw === 'object') {
    for (const key of BOOLEAN_PREFERENCES) {
      const value = (raw as Record<string, unknown>)[key];
      if (typeof value === 'boolean') clean[key] = value;
    }
    for (const key of PREFERENCE_KEYS) {
      const value = migrateLegacy(key, (raw as Record<string, unknown>)[key]);
      if (isAllowed(key, value)) clean[key] = value;
    }
  }
  return clean as Preferences;
}

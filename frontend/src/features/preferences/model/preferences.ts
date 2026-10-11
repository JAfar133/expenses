/**
 * Настройки интерфейса, которые запоминаются для пользователя. Одно описание на всё приложение:
 * его используют и сами графики (допустимые значения, подписи), и страница настроек.
 * Ключи и значения должны совпадать с теми, что принимает сервер (`preferences.schema.ts`).
 */
export interface PreferenceOption<V extends string> {
  value: V;
  label: string;
}

interface PreferenceDefinition<V extends string> {
  /** Название настройки на странице настроек */
  label: string;
  /** Пояснение под названием */
  description?: string;
  /** Значение, пока пользователь ничего не выбрал */
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
      { value: 'columns', label: 'Столбики' },
      { value: 'donut', label: 'Кольцо' },
      { value: 'pie', label: 'Круг' },
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
  'filters.panel': define({
    label: 'Панель фильтров',
    description: 'Раскрыта или свёрнута при открытии анализа',
    fallback: 'closed',
    options: [
      { value: 'closed', label: 'Свёрнута' },
      { value: 'open', label: 'Раскрыта' },
    ],
  }),
} as const;

export type PreferenceKey = keyof typeof PREFERENCES;
export type PreferenceValue<K extends PreferenceKey> =
  (typeof PREFERENCES)[K]['options'][number]['value'];

export const PREFERENCE_KEYS = Object.keys(PREFERENCES) as PreferenceKey[];

/** Все сохранённые настройки: только те, что пользователь менял. */
export type Preferences = { [K in PreferenceKey]?: PreferenceValue<K> };

export const isAllowed = <K extends PreferenceKey>(
  key: K,
  value: unknown,
): value is PreferenceValue<K> => PREFERENCES[key].options.some((option) => option.value === value);

/** Значения по умолчанию для всех настроек. */
export const defaultPreferences = (): Preferences =>
  Object.fromEntries(PREFERENCE_KEYS.map((key) => [key, PREFERENCES[key].fallback])) as Preferences;

/** Оставляет только известные ключи с допустимыми значениями: ответу сервера и старым записям не доверяем слепо. */
export function sanitizePreferences(raw: unknown): Preferences {
  const clean: Record<string, string> = {};
  if (raw && typeof raw === 'object') {
    for (const key of PREFERENCE_KEYS) {
      const value = (raw as Record<string, unknown>)[key];
      if (isAllowed(key, value)) clean[key] = value;
    }
  }
  return clean as Preferences;
}

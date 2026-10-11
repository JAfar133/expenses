import type { NameSuggestion } from '../api/expenses.api.ts';

/** Сколько подсказок показываем: остальные дальше по популярности не нужны. */
export const MAX_SUGGESTIONS = 30;

interface PickOptions {
  /** Выбранная категория; пусто: подсказок нет */
  category: string;
  /** Уже введённый текст наименования */
  query: string;
  limit?: number;
}

const normalize = (text: string) => text.trim().toLowerCase();

/**
 * Подсказки для поля «Наименование» из выбранной категории, от самых популярных к редким.
 * Исходный список уже отсортирован сервером, порядок сохраняется. Пока категория не выбрана, подсказок нет.
 */
export function pickSuggestions(
  all: NameSuggestion[],
  { category, query, limit = MAX_SUGGESTIONS }: PickOptions,
): NameSuggestion[] {
  if (!category) return [];

  const typed = normalize(query);
  return all
    .filter((item) => {
      if (item.category !== category) return false;
      const name = normalize(item.name);
      // Точное совпадение уже введено: подсказывать его незачем
      return name.includes(typed) && name !== typed;
    })
    .slice(0, limit);
}

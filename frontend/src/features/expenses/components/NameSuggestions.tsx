import type { NameSuggestion } from '../api/expenses.api.ts';

interface NameSuggestionsProps {
  suggestions: NameSuggestion[];
  onPick: (suggestion: NameSuggestion) => void;
}

/**
 * Быстрый выбор наименования из того, что уже вводили, от самых частых к редким.
 * Высота ограничена примерно тремя строками, остальное прокручивается по вертикали.
 */
export function NameSuggestions({ suggestions, onPick }: NameSuggestionsProps) {
  if (suggestions.length === 0) return null;

  return (
    <div
      role="group"
      aria-label="Подсказки наименования"
      className="flex max-h-32 flex-wrap gap-2 overflow-y-auto overscroll-contain py-0.5"
    >
      {suggestions.map((suggestion) => (
        <button
          key={`${suggestion.category}/${suggestion.name}`}
          type="button"
          onClick={() => onPick(suggestion)}
          className={
            'h-9 max-w-full truncate rounded-full border border-zinc-300 bg-white px-3.5 text-sm ' +
            'text-zinc-700 transition hover:border-indigo-400 active:scale-95 ' +
            'dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200'
          }
        >
          {suggestion.name}
        </button>
      ))}
    </div>
  );
}

import { SparkIcon } from '../../../shared/ui/icons.tsx';

/** Under «Категория»: what the AI thinks, quiet, with «Выбрать». Never replaces the choice by itself. */
export function CategorySuggestion({
  category,
  onChoose,
}: {
  category: string;
  onChoose: () => void;
}) {
  return (
    <p className="flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
      <span className="text-violet-500 dark:text-violet-400">
        <SparkIcon />
      </span>
      <span>ИИ считает: {category}</span>
      <span aria-hidden="true">·</span>
      <button
        type="button"
        onClick={onChoose}
        className="font-medium text-indigo-700 hover:underline dark:text-indigo-300"
      >
        Выбрать
      </button>
    </p>
  );
}

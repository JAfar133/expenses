import { SparkIcon } from '../../../shared/ui/icons.tsx';

interface AiSuggestionProps {
  /** «ИИ считает» / «ИИ предлагает» */
  lead: string;
  value: string;
  onChoose: () => void;
}

/** Under a field: what the AI thinks of its value, quiet, with «Выбрать». Never replaces the person's choice by itself. */
export function AiSuggestion({ lead, value, onChoose }: AiSuggestionProps) {
  return (
    <p className="flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
      <span className="text-violet-500 dark:text-violet-400">
        <SparkIcon />
      </span>
      <span>
        {lead}: {value}
      </span>
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

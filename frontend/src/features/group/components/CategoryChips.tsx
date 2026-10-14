interface CategoryChipsProps {
  /** A short caption over the chips (the count row above may serve instead) */
  caption?: string;
  /** The accessible name of the group of chips */
  label: string;
  categories: { id: string | number; name: string }[];
  isChosen: (name: string) => boolean;
  onToggle: (name: string) => void;
  disabled?: boolean;
  /** One more muted line under the chips */
  hint?: string;
}

/** Chips of categories: chosen ones filled, the rest outlined. The same look wherever categories are chosen. */
export function CategoryChips({
  caption,
  label,
  categories,
  isChosen,
  onToggle,
  disabled = false,
  hint,
}: CategoryChipsProps) {
  return (
    <div className="space-y-2">
      {caption && <p className="text-xs text-zinc-500 dark:text-zinc-400">{caption}</p>}
      <div role="group" aria-label={label} className="flex flex-wrap gap-2">
        {categories.map((category) => {
          const chosen = isChosen(category.name);
          return (
            <button
              key={category.id}
              type="button"
              aria-pressed={chosen}
              disabled={disabled}
              onClick={() => onToggle(category.name)}
              className={
                'h-9 rounded-full border px-3.5 text-sm transition disabled:opacity-60 ' +
                (chosen
                  ? 'border-violet-600 bg-violet-600 text-white'
                  : 'border-zinc-300 bg-white text-zinc-700 hover:border-violet-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200')
              }
            >
              {category.name}
            </button>
          );
        })}
      </div>
      {hint && <p className="text-xs text-zinc-500 dark:text-zinc-400">{hint}</p>}
    </div>
  );
}

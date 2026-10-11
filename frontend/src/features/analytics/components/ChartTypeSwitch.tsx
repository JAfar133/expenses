interface Option<T extends string> {
  value: T;
  label: string;
}

interface ChartTypeSwitchProps<T extends string> {
  /** Что переключаем, для скринридера */
  label: string;
  options: Option<T>[];
  value: T;
  onChange: (value: T) => void;
}

/** Переключатель вида графика (сегментированный): столбики, линия, кольцо… */
export function ChartTypeSwitch<T extends string>({
  label,
  options,
  value,
  onChange,
}: ChartTypeSwitchProps<T>) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="inline-flex max-w-full flex-wrap rounded-lg bg-zinc-100 p-0.5 dark:bg-zinc-800"
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(option.value)}
            className={
              'h-8 rounded-md px-3 text-sm font-medium transition ' +
              (active
                ? 'bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-zinc-50'
                : 'text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100')
            }
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

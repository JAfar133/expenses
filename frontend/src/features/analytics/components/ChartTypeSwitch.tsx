interface Option<T extends string> {
  value: T;
  label: string;
}

interface ChartTypeSwitchProps<T extends string> {
  /** Что переключаем, для скринридера */
  label: string;
  options: readonly Option<T>[];
  value: T;
  onChange: (value: T) => void;
  /**
   * На телефоне: растянуть переключатель на всю ширину равными колонками (столько колонок).
   * Без значения варианты просто переносятся по строкам.
   */
  mobileColumns?: 2 | 3 | 4;
}

const GRID_COLUMNS = { 2: 'grid-cols-2', 3: 'grid-cols-3', 4: 'grid-cols-4' } as const;

/** Переключатель вида графика (сегментированный): столбики, линия, кольцо… */
export function ChartTypeSwitch<T extends string>({
  label,
  options,
  value,
  onChange,
  mobileColumns,
}: ChartTypeSwitchProps<T>) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={
        'max-w-full rounded-lg bg-zinc-100 p-0.5 dark:bg-zinc-800 ' +
        (mobileColumns
          ? `grid w-full ${GRID_COLUMNS[mobileColumns]} sm:inline-flex sm:w-auto sm:flex-wrap`
          : 'inline-flex flex-wrap')
      }
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
              'h-8 rounded-md px-2 text-sm font-medium transition sm:px-3 ' +
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

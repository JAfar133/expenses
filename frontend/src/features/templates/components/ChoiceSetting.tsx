import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react';

export interface Choice<T extends string> {
  value: T;
  label: string;
  icon: ReactNode;
}

/**
 * A settings row: a title, a segmented control (icon over a label, the chosen one is a raised pill, the same look as
 * the theme switch) and one helper line that describes the CURRENT choice. Optional `preview` sits next to the helper.
 */
export function ChoiceSetting<T extends string>({
  title,
  choices,
  value,
  onChange,
  helper,
  preview,
}: {
  title: string;
  choices: Choice<T>[];
  value: T;
  onChange: (value: T) => void;
  helper: string;
  preview?: ReactNode;
}) {
  const labelId = useId();
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);

  const move = (event: KeyboardEvent, index: number) => {
    const step =
      event.key === 'ArrowRight' || event.key === 'ArrowDown'
        ? 1
        : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
          ? -1
          : 0;
    if (step === 0) return;
    event.preventDefault();
    const next = (index + step + choices.length) % choices.length;
    onChange(choices[next]!.value);
    buttons.current[next]?.focus();
  };

  return (
    <div className="space-y-2">
      <div id={labelId} className="text-sm font-medium">
        {title}
      </div>
      <div
        role="radiogroup"
        aria-labelledby={labelId}
        className="grid gap-1 rounded-2xl bg-zinc-100 p-1 dark:bg-zinc-800"
        style={{ gridTemplateColumns: `repeat(${choices.length}, minmax(0, 1fr))` }}
      >
        {choices.map((choice, index) => {
          const active = choice.value === value;
          return (
            <button
              key={choice.value}
              ref={(element) => {
                buttons.current[index] = element;
              }}
              type="button"
              role="radio"
              aria-checked={active}
              tabIndex={active ? 0 : -1}
              onClick={() => onChange(choice.value)}
              onKeyDown={(event) => move(event, index)}
              className={
                'flex min-h-16 flex-col items-center justify-center gap-1 rounded-xl px-2 py-2 text-xs transition ' +
                (active
                  ? 'bg-white font-semibold text-zinc-900 shadow-sm dark:bg-zinc-600 dark:text-zinc-50'
                  : 'text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-100')
              }
            >
              <span className="[&>svg]:size-6">{choice.icon}</span>
              {choice.label}
            </button>
          );
        })}
      </div>
      <div className="flex items-center gap-3">
        <p className="min-w-0 flex-1 text-sm text-zinc-500 dark:text-zinc-400">{helper}</p>
        {preview}
      </div>
    </div>
  );
}

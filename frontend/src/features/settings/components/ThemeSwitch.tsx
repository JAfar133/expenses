import { useRef, type KeyboardEvent, type ReactNode } from 'react';
import { MonitorIcon, MoonIcon, SunIcon } from '../../../shared/ui/icons.tsx';
import { usePreference } from '../../preferences/hooks/usePreferences.ts';
import { PREFERENCES } from '../../preferences/model/preferences.ts';

const ICONS: Record<string, ReactNode> = {
  system: <MonitorIcon />,
  light: <SunIcon />,
  dark: <MoonIcon />,
};

/**
 * «Тема приложения»: one rounded track with three equal segments, an icon over a label in each. The chosen one is a
 * raised pill. A radio group: the arrows move the choice, a tap saves it at once.
 */
export function ThemeSwitch() {
  const options = PREFERENCES.theme.options;
  const [value, change] = usePreference('theme');
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
    const next = (index + step + options.length) % options.length;
    change(options[next]!.value);
    buttons.current[next]?.focus();
  };

  return (
    <div className="space-y-2">
      <div id="theme-label" className="text-sm font-medium">
        Тема приложения
      </div>
      <div
        role="radiogroup"
        aria-labelledby="theme-label"
        className="grid grid-cols-3 gap-1 rounded-2xl bg-zinc-100 p-1 dark:bg-zinc-800"
      >
        {options.map((option, index) => {
          const active = option.value === value;
          return (
            <button
              key={option.value}
              ref={(element) => {
                buttons.current[index] = element;
              }}
              type="button"
              role="radio"
              aria-checked={active}
              tabIndex={active ? 0 : -1}
              onClick={() => change(option.value)}
              onKeyDown={(event) => move(event, index)}
              className={
                'flex min-h-16 flex-col items-center justify-center gap-1 rounded-xl px-2 py-2 text-xs transition ' +
                (active
                  ? 'bg-white font-semibold text-zinc-900 shadow-sm dark:bg-zinc-600 dark:text-zinc-50'
                  : 'text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-100')
              }
            >
              <span className="[&>svg]:size-6">{ICONS[option.value]}</span>
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

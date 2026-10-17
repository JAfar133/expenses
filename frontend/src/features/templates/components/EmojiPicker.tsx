import { useState } from 'react';
import { SmileIcon } from '../../../shared/ui/icons.tsx';

/** A short list of emojis that suit expenses; any other one can be typed or pasted in the field below the grid. */
export const EMOJIS = [
  '🛒',
  '🍎',
  '🥖',
  '🥛',
  '🍕',
  '🍔',
  '☕',
  '🍺',
  '🍷',
  '🍽️',
  '🍨',
  '🚌',
  '🚕',
  '🚇',
  '🚗',
  '⛽',
  '🅿️',
  '✈️',
  '🏠',
  '💡',
  '🔥',
  '💧',
  '📶',
  '📱',
  '💊',
  '🏥',
  '🦷',
  '👕',
  '👟',
  '🎁',
  '🎬',
  '🎮',
  '🎵',
  '📚',
  '🎓',
  '🏋️',
  '💇',
  '🧴',
  '🧹',
  '🐶',
  '🐱',
  '🧸',
  '👶',
  '🍼',
  '🔧',
  '💼',
  '🏦',
  '💳',
  '🧾',
  '✂️',
  '🌐',
  '❤️',
  '⭐',
  '🥗',
  '🍞',
  '🧃',
  '🚲',
  '🛠️',
  '🧺',
  '🎂',
];

interface EmojiPickerProps {
  value: string;
  onChange: (emoji: string) => void;
  id?: string;
}

/**
 * The emoji of a template: a button with the current one (or «Выбрать») opens a grid of 8 columns under it; a tap
 * chooses, «Без эмодзи» clears, and the small field takes any emoji from the system keyboard.
 */
export function EmojiPicker({ value, onChange, id }: EmojiPickerProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className="space-y-2">
      <button
        id={id}
        type="button"
        aria-expanded={open}
        aria-label={value ? `Эмодзи: ${value}. Изменить` : 'Выбрать эмодзи'}
        onClick={() => setOpen((current) => !current)}
        className="flex h-12 items-center gap-2 rounded-xl border border-zinc-300 bg-white px-4 text-base dark:border-zinc-700 dark:bg-zinc-900"
      >
        {value ? (
          <span className="text-2xl leading-none">{value}</span>
        ) : (
          <>
            <SmileIcon />
            <span className="text-sm text-zinc-600 dark:text-zinc-300">Выбрать</span>
          </>
        )}
      </button>
      {open && (
        <div
          role="group"
          aria-label="Эмодзи"
          className="space-y-2 rounded-xl border border-zinc-200 bg-zinc-50 p-2 dark:border-zinc-700 dark:bg-zinc-800/40"
        >
          <div className="grid grid-cols-8 gap-1">
            {EMOJIS.map((emoji) => (
              <button
                key={emoji}
                type="button"
                aria-label={emoji}
                aria-pressed={value === emoji}
                onClick={() => {
                  onChange(emoji);
                  setOpen(false);
                }}
                className={
                  'flex aspect-square items-center justify-center rounded-lg text-xl hover:bg-white dark:hover:bg-zinc-700 ' +
                  (value === emoji ? 'bg-white ring-2 ring-indigo-500 dark:bg-zinc-700' : '')
                }
              >
                {emoji}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <input
              aria-label="Свой эмодзи"
              placeholder="Свой эмодзи"
              value={value}
              maxLength={8}
              onChange={(event) => onChange(event.target.value)}
              className="h-10 min-w-0 flex-1 rounded-lg border border-zinc-300 bg-white px-3 text-base dark:border-zinc-700 dark:bg-zinc-900"
            />
            <button
              type="button"
              onClick={() => {
                onChange('');
                setOpen(false);
              }}
              className="h-10 shrink-0 rounded-lg px-3 text-sm font-medium text-indigo-700 hover:bg-white dark:text-indigo-300 dark:hover:bg-zinc-700"
            >
              Без эмодзи
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

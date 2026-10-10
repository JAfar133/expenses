import type { ReactNode } from 'react';

interface FieldProps {
  label: string;
  htmlFor?: string;
  error?: string;
  children: ReactNode;
}

export function Field({ label, htmlFor, error, children }: FieldProps) {
  return (
    <div className="space-y-1.5">
      <label
        htmlFor={htmlFor}
        className="block text-sm font-medium text-zinc-600 dark:text-zinc-400"
      >
        {label}
      </label>
      {children}
      {error && (
        <p
          id={htmlFor ? `${htmlFor}-error` : undefined}
          className="text-sm text-red-600 dark:text-red-400"
        >
          {error}
        </p>
      )}
    </div>
  );
}

/** Общий вид полей ввода: высота ≥ 48px и шрифт 16px (iOS не увеличивает страницу при фокусе). */
export const inputClassName =
  'block h-12 w-full min-w-0 appearance-none rounded-xl border border-zinc-300 bg-white px-4 text-base ' +
  'outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30 ' +
  'aria-invalid:border-red-500 dark:border-zinc-700 dark:bg-zinc-900';

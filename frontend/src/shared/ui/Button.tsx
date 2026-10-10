import type { ButtonHTMLAttributes } from 'react';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  loading?: boolean;
}

export function Button({
  loading = false,
  disabled,
  children,
  className = '',
  ...props
}: ButtonProps) {
  return (
    <button
      {...props}
      disabled={disabled || loading}
      aria-busy={loading}
      className={
        'flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 text-base ' +
        'font-semibold text-white transition active:scale-[0.99] hover:bg-indigo-500 ' +
        `disabled:cursor-not-allowed disabled:opacity-60 ${className}`
      }
    >
      {loading && (
        <span
          aria-hidden="true"
          className="size-5 animate-spin rounded-full border-2 border-white/40 border-t-white"
        />
      )}
      {children}
    </button>
  );
}

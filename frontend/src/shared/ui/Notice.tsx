import type { ReactNode } from 'react';

type NoticeVariant = 'success' | 'error' | 'info';

const STYLES: Record<NoticeVariant, string> = {
  success: 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200',
  error: 'bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-200',
  info: 'bg-amber-50 text-amber-900 dark:bg-amber-950 dark:text-amber-200',
};

export function Notice({ variant, children }: { variant: NoticeVariant; children: ReactNode }) {
  return (
    <div
      role={variant === 'error' ? 'alert' : 'status'}
      className={`rounded-xl px-4 py-3 text-sm font-medium ${STYLES[variant]}`}
    >
      {children}
    </div>
  );
}

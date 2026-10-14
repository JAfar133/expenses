import type { ReactNode } from 'react';

/** The icon of a settings row: 24px in a round 40px badge. */
export function IconBadge({ children }: { children: ReactNode }) {
  return (
    <span
      aria-hidden="true"
      className="flex size-10 shrink-0 items-center justify-center rounded-full bg-indigo-50 text-indigo-600 dark:bg-indigo-950/60 dark:text-indigo-300 [&>svg]:size-6"
    >
      {children}
    </span>
  );
}

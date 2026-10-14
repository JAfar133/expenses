import type { ReactNode } from 'react';
import { InfoIcon } from '../../../shared/ui/icons.tsx';

/** A quiet information plate on a tinted background with an info icon: the same everywhere in the settings. */
export function InfoNote({ children }: { children: ReactNode }) {
  return (
    <div
      role="note"
      className="flex items-start gap-2 rounded-xl bg-zinc-50 px-3 py-2.5 text-xs text-zinc-600 dark:bg-zinc-800/50 dark:text-zinc-300"
    >
      <span className="mt-0.5 shrink-0 text-zinc-400 dark:text-zinc-500">
        <InfoIcon />
      </span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

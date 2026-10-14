import type { ReactNode } from 'react';
import { ChevronRightSmallIcon } from '../../../shared/ui/icons.tsx';
import { IconBadge } from './IconBadge.tsx';

interface LinkRowProps {
  icon: ReactNode;
  title: string;
  description: string;
  /** The current value at the right */
  value: string;
  /** Without it the row is not a button (nothing to choose) */
  onOpen?: () => void;
}

/** A row of the main settings: icon, title with a small line under it, the value and a chevron; a tap opens a window. */
export function LinkRow({ icon, title, description, value, onOpen }: LinkRowProps) {
  const content = (
    <>
      <IconBadge>{icon}</IconBadge>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{title}</span>
        <span className="block text-xs text-zinc-500 dark:text-zinc-400">{description}</span>
      </span>
      <span className="max-w-32 truncate text-sm text-zinc-600 dark:text-zinc-300">{value}</span>
      {onOpen && (
        <span aria-hidden="true" className="shrink-0 text-zinc-400">
          <ChevronRightSmallIcon />
        </span>
      )}
    </>
  );
  const className = 'flex min-h-16 w-full items-center gap-3 py-2 text-left';
  return onOpen ? (
    <button type="button" onClick={onOpen} className={className}>
      {content}
    </button>
  ) : (
    <div className={className}>{content}</div>
  );
}

import type { ReactNode } from 'react';

interface ListRowProps {
  /** The name (and login) */
  main: ReactNode;
  /** A badge or role control under the name */
  badge?: ReactNode;
  /** Actions (a `RowActions`) */
  children?: ReactNode;
  /** Something that expands under the row: a link panel, access settings */
  below?: ReactNode;
}

/**
 * One list row for the group and admin pages, the same on every width: the name (long ones wrap) on the left,
 * icon actions on the right.
 */
export function ListRow({ main, badge, children, below }: ListRowProps) {
  return (
    <li className="py-2">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1 break-words">
          {main}
          {badge && <div className="mt-1 flex">{badge}</div>}
        </div>
        {children}
      </div>
      {below}
    </li>
  );
}

/** Row actions: a compact line of icon buttons at the right edge. */
export function RowActions({ children }: { children: ReactNode }) {
  return <div className="flex shrink-0 items-center gap-0.5 sm:gap-1">{children}</div>;
}

const BASE =
  'flex size-10 items-center justify-center rounded-lg transition focus-visible:outline-none ' +
  'focus-visible:ring-2 focus-visible:ring-indigo-500/60 disabled:cursor-not-allowed disabled:opacity-60 sm:size-9';
const TONES = {
  default: 'text-indigo-600 hover:bg-indigo-50 dark:text-indigo-300 dark:hover:bg-indigo-950/60',
  danger: 'text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/60',
  success: 'text-green-700 hover:bg-green-50 dark:text-green-400 dark:hover:bg-green-950/60',
} as const;

interface ActionButtonProps {
  /** The accessible name and the tooltip */
  label: string;
  icon: ReactNode;
  tone?: keyof typeof TONES;
  disabled?: boolean;
  'aria-expanded'?: boolean;
  onClick: () => void;
}

/** An icon button for row actions; destructive ones are red, restoring ones green. */
export function ActionButton({ label, icon, tone = 'default', ...props }: ActionButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      {...props}
      className={`${BASE} ${TONES[tone]}`}
    >
      {icon}
    </button>
  );
}

/** A compact role control shaped like a badge, for a select under the member's name. */
export const roleSelectClass =
  'h-9 rounded-full border border-zinc-300 bg-zinc-100 px-3 text-base font-medium ' +
  'dark:border-zinc-700 dark:bg-zinc-800';

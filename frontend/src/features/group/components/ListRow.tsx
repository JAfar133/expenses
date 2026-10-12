import { Children, type ButtonHTMLAttributes, type ReactNode } from 'react';

const COLUMNS: Record<number, string> = {
  1: 'grid-cols-1',
  2: 'grid-cols-2',
  3: 'grid-cols-3',
  4: 'grid-cols-4',
};

interface ListRowProps {
  /** Line 1, left: the name (and login) */
  main: ReactNode;
  /** Line 1, right edge: a badge */
  badge?: ReactNode;
  /** Actions (a `RowActions`) */
  children?: ReactNode;
  /** Something that expands under the row: a link panel, access settings */
  below?: ReactNode;
}

/**
 * One list row for the group and admin pages. Phone: line 1 is the name (badge at the right edge), line 2 is the
 * actions in an equal-width grid. Desktop: a single line, the name takes the free space, the actions sit on the right.
 */
export function ListRow({ main, badge, children, below }: ListRowProps) {
  return (
    <li className="py-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
        <div className="flex min-w-0 items-center justify-between gap-2 sm:flex-1">
          <div className="min-w-0">{main}</div>
          {badge}
        </div>
        {children}
      </div>
      {below}
    </li>
  );
}

/** Row actions: equal columns on a phone (as many as there are actions), a right-aligned line on desktop. */
export function RowActions({ children }: { children: ReactNode }) {
  const count = Children.toArray(children).length;
  return (
    <div
      className={`grid w-full gap-2 sm:flex sm:w-auto sm:shrink-0 sm:justify-end ${COLUMNS[count] ?? 'grid-cols-2'}`}
    >
      {children}
    </div>
  );
}

const BASE =
  'flex min-h-10 items-center justify-center rounded-lg border px-2 py-1 text-center text-sm font-medium ' +
  'leading-tight transition disabled:cursor-not-allowed disabled:opacity-60 sm:min-h-9 sm:min-w-[6.5rem] sm:px-3';
const TONES = {
  default:
    'border-indigo-200 text-indigo-700 hover:bg-indigo-50 dark:border-indigo-900 dark:text-indigo-300 dark:hover:bg-indigo-950/60',
  danger:
    'border-zinc-300 text-red-700 hover:bg-red-50 dark:border-zinc-700 dark:text-red-300 dark:hover:bg-red-950/60',
} as const;

interface ActionButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  tone?: keyof typeof TONES;
}

/** A small outlined button for row actions; destructive ones use a calmer red tone. */
export function ActionButton({ tone = 'default', className = '', ...props }: ActionButtonProps) {
  return <button type="button" {...props} className={`${BASE} ${TONES[tone]} ${className}`} />;
}

/** The same height and look as `ActionButton`, for a select placed in the actions grid. */
export const actionSelectClass =
  'min-h-10 w-full min-w-0 rounded-lg border border-zinc-300 bg-white px-2 text-sm dark:border-zinc-700 ' +
  'dark:bg-zinc-900 sm:min-h-9 sm:w-auto sm:min-w-[6.5rem]';

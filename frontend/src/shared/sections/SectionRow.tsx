import { NavLink } from 'react-router';
import { ChevronRightIcon } from '../ui/icons.tsx';
import { TONES, type RowData } from './model.ts';

/** The colored rounded square with the icon of a row. */
export const IconSquare = ({
  tone,
  children,
}: {
  tone: RowData['tone'];
  children: RowData['icon'];
}) => (
  <span
    aria-hidden="true"
    className={`flex size-9 shrink-0 items-center justify-center rounded-xl text-white [&>svg]:size-5 ${TONES[tone]}`}
  >
    {children}
  </span>
);

/**
 * A row of a sections list: an icon square, a title, a line under it, the current value, a red badge and a chevron.
 * `menu`: the compact look of the side menu on a desktop (the open section highlighted, only the badge on the right,
 * so that titles are not cut).
 */
export function SectionRow({ row, menu = false }: { row: RowData; menu?: boolean }) {
  const badge = row.badge !== undefined && row.badge > 0 ? row.badge : null;
  return (
    <NavLink
      to={row.to}
      className={({ isActive }) =>
        'flex min-h-14 items-center gap-3 px-4 py-2 text-left transition ' +
        (menu && isActive
          ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300'
          : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/60')
      }
    >
      <IconSquare tone={row.tone}>{row.icon}</IconSquare>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-base font-medium">{row.title}</span>
        {row.subtitle && !menu && (
          <span className="block truncate text-sm text-zinc-500 dark:text-zinc-400">
            {row.subtitle}
          </span>
        )}
      </span>
      {row.value && !menu && (
        <span className="shrink-0 text-sm text-zinc-500 dark:text-zinc-400">{row.value}</span>
      )}
      {badge !== null && (
        <span
          aria-label={`${badge} ждут решения`}
          className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-red-600 px-1.5 text-xs font-bold text-white"
        >
          {menu || !row.badgeSuffix ? badge : `${badge} ${row.badgeSuffix}`}
        </span>
      )}
      {!menu && (
        <span aria-hidden="true" className="shrink-0 text-zinc-400">
          <ChevronRightIcon />
        </span>
      )}
    </NavLink>
  );
}

import { Suspense, type ReactNode } from 'react';
import { Link, Navigate, useLocation, useParams } from 'react-router';
import { useIsMedium } from '../hooks/useIsMedium.ts';
import { EmbeddedContext } from './embedded.ts';
import type { RowGroup } from './model.ts';
import { SectionRow } from './SectionRow.tsx';

const GROUP = 'overflow-hidden rounded-2xl bg-white shadow-sm dark:bg-zinc-900';
const LABEL =
  'px-4 pt-5 pb-1.5 text-xs font-semibold tracking-wide text-zinc-500 uppercase dark:text-zinc-400';

interface SectionsPageProps {
  /** The address of the hub, e.g. `/settings`; the sections are `<base>/<id>` */
  base: string;
  /** The title of the hub (a phone) and of the side menu (a desktop) */
  hubTitle: string;
  /** A link above the title of the hub: «‹ Настройки» */
  hubBack?: { to: string; label: string };
  /** Above the lists on the hub of a phone: a profile row */
  hubTop?: ReactNode;
  /** Below the lists on the hub of a phone: the exit */
  hubFooter?: ReactNode;
  groups: RowGroup[];
  sections: { id: string; title: string }[];
  /** The section a desktop opens when the hub is asked for */
  firstSection: string;
  /** The text of «‹ …» on a section screen of a phone */
  backLabel: string;
  renderSection: (id: string) => ReactNode;
  /** An old `#hash` of the hub and the section it now belongs to */
  legacyHash?: { hash: string; to: string };
}

/**
 * Pages made of sections (the personal settings, the group): on a phone a list (the hub) that opens a section screen
 * with a «‹ back» link; from `md` up a sticky menu on the left and the section on the right (the hub goes to the first
 * section). A section screen gives the cards `EmbeddedContext`, so they leave out their own titles.
 */
export function SectionsPage(props: SectionsPageProps) {
  const medium = useIsMedium();
  const { hash } = useLocation();
  const section = useParams()['*'] || undefined;
  const { base, sections } = props;

  if (!section) {
    if (props.legacyHash && hash === props.legacyHash.hash) {
      return <Navigate to={props.legacyHash.to} replace />;
    }
    return medium ? <Navigate to={`${base}/${props.firstSection}`} replace /> : <Hub {...props} />;
  }
  const current = sections.find((item) => item.id === section);
  if (!current) return <Navigate to={base} replace />;

  const screen = (back: boolean) => (
    <div className="space-y-4">
      <div>
        {back && (
          <Link
            to={base}
            className="-ml-2 inline-flex h-11 items-center gap-0.5 rounded-lg px-2 text-base font-medium text-indigo-600 dark:text-indigo-400"
          >
            <span aria-hidden="true" className="text-xl leading-none">
              ‹
            </span>
            {props.backLabel}
          </Link>
        )}
        <h2 className="text-3xl font-bold md:text-2xl">{current.title}</h2>
      </div>
      <EmbeddedContext.Provider value>
        <Suspense
          fallback={
            <p role="status" className="py-6 text-center text-zinc-500">
              Загрузка…
            </p>
          }
        >
          {props.renderSection(current.id)}
        </Suspense>
      </EmbeddedContext.Provider>
    </div>
  );

  if (!medium) return screen(true);
  return (
    <div className="grid grid-cols-[19rem_minmax(0,1fr)] items-start gap-6">
      <aside className="sticky top-4 space-y-4 self-start">
        <h2 className="truncate text-2xl font-bold">{props.hubTitle}</h2>
        {props.groups.map((group, index) => (
          <nav
            key={index}
            aria-label={group.menuLabel ?? group.label ?? `${props.hubTitle}: разделы`}
            className={`${GROUP} divide-y divide-zinc-100 dark:divide-zinc-800`}
          >
            {group.rows.map((row) => (
              <SectionRow key={row.to} row={row} menu />
            ))}
          </nav>
        ))}
      </aside>
      {screen(false)}
    </div>
  );
}

function Hub(props: SectionsPageProps) {
  return (
    <div>
      {props.hubBack && (
        <Link
          to={props.hubBack.to}
          className="-ml-2 inline-flex h-11 items-center gap-0.5 rounded-lg px-2 text-base font-medium text-indigo-600 dark:text-indigo-400"
        >
          <span aria-hidden="true" className="text-xl leading-none">
            ‹
          </span>
          {props.hubBack.label}
        </Link>
      )}
      <h2 className="mb-3 text-3xl font-bold">{props.hubTitle}</h2>
      {props.hubTop}
      {props.groups.map((group, index) => (
        <div key={index}>
          {group.label && <h3 className={LABEL}>{group.label}</h3>}
          <nav
            aria-label={group.label ?? 'Разделы'}
            className={`${GROUP} divide-y divide-zinc-100 dark:divide-zinc-800 ${group.label ? '' : 'mt-3'}`}
          >
            {group.rows.map((row) => (
              <SectionRow key={row.to} row={row} />
            ))}
          </nav>
        </div>
      ))}
      {props.hubFooter}
    </div>
  );
}

import { Suspense } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router';
import type { AuthUser } from '../features/auth/api/auth.api.ts';
import { UserBar } from '../features/auth/components/UserBar.tsx';
import { SyncIndicator } from '../features/sync/components/SyncIndicator.tsx';
import { PlusIcon } from '../shared/ui/icons.tsx';

/** «Добавить» is the main action: a filled button. */
const addClass = ({ isActive }: { isActive: boolean }) =>
  'inline-flex h-8 items-center gap-1 rounded-full px-3 text-sm font-semibold bg-indigo-600 text-white transition ' +
  (isActive ? 'brightness-90' : 'hover:bg-indigo-500');

/** «Аналитика» is a calm section: text, the active one is indigo with a thin line below. */
const sectionClass = ({ isActive }: { isActive: boolean }) =>
  'inline-flex h-10 items-center border-b-2 px-1 text-sm font-medium transition ' +
  (isActive
    ? 'border-indigo-600 text-indigo-700 dark:border-indigo-400 dark:text-indigo-300'
    : 'border-transparent text-zinc-600 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-zinc-50');

/**
 * Common page frame. Line 1: the title, on a wide screen the main navigation, the sync icon and the user menu.
 * On a phone the navigation moves to its own second line.
 */
export function AppShell({ user }: { user: AuthUser }) {
  // The form fits a narrow column; the analytics page uses the full width
  const { pathname } = useLocation();
  const wide = pathname.startsWith('/analytics');
  const medium = ['/settings', '/group', '/admin'].some((path) => pathname.startsWith(path));

  return (
    <main
      className={`mx-auto min-h-dvh w-full px-4 pb-[max(2rem,env(safe-area-inset-bottom))] pt-[max(1.5rem,env(safe-area-inset-top))] ${
        wide ? 'max-w-5xl' : medium ? 'max-w-2xl' : 'max-w-[560px]'
      }`}
    >
      <header className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2">
        <h1 className="order-1 text-2xl font-bold">💳 Мои расходы</h1>
        <div className="order-2 ml-auto flex items-center gap-2 sm:order-3">
          <SyncIndicator />
          <UserBar user={user} />
        </div>
        <nav
          aria-label="Разделы"
          className="order-3 flex w-full items-center gap-5 sm:order-2 sm:w-auto"
        >
          <NavLink to="/" end className={addClass}>
            <PlusIcon />
            Добавить
          </NavLink>
          <NavLink to="/analytics" className={sectionClass}>
            Аналитика
          </NavLink>
        </nav>
      </header>

      <Suspense
        fallback={
          <p role="status" className="py-8 text-center text-zinc-500">
            Загрузка…
          </p>
        }
      >
        <Outlet />
      </Suspense>
    </main>
  );
}

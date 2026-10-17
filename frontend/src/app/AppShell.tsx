import { Suspense } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router';
import type { AuthUser } from '../features/auth/api/auth.api.ts';
import { UserBar } from '../features/auth/components/UserBar.tsx';
import { useTheme } from '../features/preferences/hooks/useTheme.ts';
import { NotificationBell } from '../features/notifications/components/NotificationBell.tsx';
import { SyncIndicator } from '../features/sync/components/SyncIndicator.tsx';
import { OfflineBanner } from '../features/offline-queue/components/OfflineBanner.tsx';
import { useQueueSync } from '../features/offline-queue/hooks/useQueueSync.ts';
import { CameraFab, useCameraFabAvailable } from '../features/receipts/components/CameraFab.tsx';
import { PlusIcon } from '../shared/ui/icons.tsx';

/** «Добавить» is the main action: a filled button; on its own page it turns into a soft "you are here" pill. */
const addClass = ({ isActive }: { isActive: boolean }) =>
  'inline-flex h-8 items-center gap-1 rounded-full px-3 text-sm font-semibold transition ' +
  (isActive
    ? 'bg-indigo-100 text-indigo-700 ring-1 ring-inset ring-indigo-300 dark:bg-indigo-950 dark:text-indigo-300 dark:ring-indigo-700'
    : 'bg-indigo-600 text-white hover:bg-indigo-500');

/** «Аналитика» is a calm section: text, the active one is indigo with a thin line below. */
const sectionClass = ({ isActive }: { isActive: boolean }) =>
  'inline-flex h-10 items-center border-b-2 px-1 text-sm font-medium transition ' +
  (isActive
    ? 'border-indigo-600 text-indigo-700 dark:border-indigo-400 dark:text-indigo-300'
    : 'border-transparent text-zinc-600 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-zinc-50');

/**
 * Common page frame. One header row: the title, on a wide screen the main navigation, and at the right the sync icon,
 * the bell and the user menu (a phone has the navigation in the bottom bar).
 */
export function AppShell({ user }: { user: AuthUser }) {
  useQueueSync();
  useTheme();
  // The form fits a narrow column; the analytics page uses the full width
  const { pathname } = useLocation();
  const wide = pathname.startsWith('/analytics');
  const medium = ['/settings', '/admin'].some((path) => pathname.startsWith(path));
  // The group page has wide rows with menus: a wider column on a desktop
  const group = pathname.startsWith('/group');
  // On a phone the round camera button must not cover the last rows and the pagination
  const fab = useCameraFabAvailable();

  return (
    <main
      className={`mx-auto min-h-dvh w-full px-4 ${fab ? 'pb-[calc(6rem+env(safe-area-inset-bottom))]' : 'pb-[calc(4.5rem+env(safe-area-inset-bottom))]'} md:pb-[max(2rem,env(safe-area-inset-bottom))] pt-[max(1.5rem,env(safe-area-inset-top))] ${
        wide ? 'max-w-5xl' : group ? 'max-w-3xl' : medium ? 'max-w-2xl' : 'max-w-[560px]'
      }`}
    >
      <header className="mb-4 flex items-center gap-x-3">
        <h1 className="min-w-0 truncate text-xl font-bold sm:text-2xl md:text-xl">
          💳 Мои расходы
        </h1>
        <nav
          aria-label="Разделы"
          // On a phone the bottom bar (always there) has the same two items: the tabs are for the wide screens
          className="flex shrink-0 items-center gap-3 max-md:hidden"
        >
          <NavLink to="/" end className={addClass}>
            <PlusIcon />
            Добавить
          </NavLink>
          <NavLink to="/analytics" className={sectionClass}>
            Аналитика
          </NavLink>
        </nav>
        {/* One group that never wraps: the sync icon, the bell and the user menu */}
        <div className="ml-auto flex shrink-0 items-center gap-1 sm:gap-2">
          <SyncIndicator />
          <NotificationBell />
          <UserBar user={user} />
        </div>
      </header>

      <OfflineBanner />

      <Suspense
        fallback={
          <p role="status" className="py-8 text-center text-zinc-500">
            Загрузка…
          </p>
        }
      >
        <Outlet />
      </Suspense>
      <CameraFab />
    </main>
  );
}

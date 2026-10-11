import { Suspense } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router';
import type { AuthUser } from '../features/auth/api/auth.api.ts';
import { UserBar } from '../features/auth/components/UserBar.tsx';
import { SyncIndicator } from '../features/sync/components/SyncIndicator.tsx';

const linkClass = ({ isActive }: { isActive: boolean }) =>
  'rounded-full px-4 py-2 text-sm font-medium transition ' +
  (isActive
    ? 'bg-indigo-600 text-white'
    : 'text-zinc-600 hover:bg-zinc-200/70 dark:text-zinc-300 dark:hover:bg-zinc-800');

/** Общая рамка страниц: заголовок, значок синхронизации, навигация и кто вошёл. */
export function AppShell({ user }: { user: AuthUser }) {
  // Форме достаточно узкой колонки, страница анализа использует всю ширину
  const wide = useLocation().pathname.startsWith('/analytics');

  return (
    <main
      className={`mx-auto min-h-dvh w-full px-4 pb-[max(2rem,env(safe-area-inset-bottom))] pt-[max(1.5rem,env(safe-area-inset-top))] ${
        wide ? 'max-w-5xl' : 'max-w-[560px]'
      }`}
    >
      <header className="mb-4 flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">💳 Мои расходы</h1>
        <SyncIndicator />
      </header>

      <nav aria-label="Разделы" className="mb-4 flex gap-2">
        <NavLink to="/" end className={linkClass}>
          Добавить
        </NavLink>
        <NavLink to="/analytics" className={linkClass}>
          Анализ
        </NavLink>
      </nav>

      <UserBar user={user} />

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

import { Link } from 'react-router';
import { hasBackupProblem, useAdminBackup } from '../../admin/hooks/useAdminBackup.ts';
import type { AuthUser } from '../api/auth.api.ts';
import { useLogout } from '../hooks/useAuth.ts';

/** Who is signed in, and the sign-out button. */
export function UserBar({ user }: { user: AuthUser }) {
  const logout = useLogout();
  // Only an application admin asks about the backup: nobody else ever requests the endpoint
  const backup = useAdminBackup(user.isAdmin);

  return (
    <div className="mb-4 flex items-center justify-between text-sm text-zinc-500 dark:text-zinc-400">
      <span>
        Вы вошли как{' '}
        <strong className="font-semibold text-zinc-800 dark:text-zinc-100">
          {user.displayName}
        </strong>
      </span>
      <div className="flex items-center gap-3">
        {logout.isError && (
          <span role="alert" className="text-red-600 dark:text-red-400">
            Не удалось выйти
          </span>
        )}
        {user.role === 'owner' && <BarLink to="/group" label="Группа" />}
        {user.isAdmin && (
          <BarLink to="/admin" label="Админ" alert={hasBackupProblem(backup.data?.state)} />
        )}
        <Link
          to="/settings"
          aria-label="Настройки"
          title="Настройки"
          className="flex size-9 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-200/60 hover:text-indigo-600 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-indigo-400"
        >
          <GearIcon />
        </Link>
        <button
          type="button"
          onClick={() => logout.mutate()}
          disabled={logout.isPending}
          className="rounded-lg px-2 py-1.5 font-medium text-indigo-600 hover:bg-zinc-200/60 disabled:opacity-60 dark:text-indigo-400 dark:hover:bg-zinc-800"
        >
          Выйти
        </button>
      </div>
    </div>
  );
}

/** A small text link for owner/admin pages: members never see these. */
function BarLink({ to, label, alert = false }: { to: string; label: string; alert?: boolean }) {
  return (
    <Link
      to={to}
      className="relative rounded-lg px-2 py-1.5 font-medium text-zinc-600 hover:bg-zinc-200/60 hover:text-indigo-600 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-indigo-400"
    >
      {label}
      {alert && (
        <>
          <span
            aria-hidden="true"
            className="absolute right-0.5 top-0.5 size-2 rounded-full bg-red-500"
          />
          <span className="sr-only">есть проблема с бэкапом</span>
        </>
      )}
    </Link>
  );
}

/** Gear (outline icon), color is taken from the text. */
function GearIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-5"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

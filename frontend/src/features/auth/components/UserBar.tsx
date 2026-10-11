import type { AuthUser } from '../api/auth.api.ts';
import { useLogout } from '../hooks/useAuth.ts';

/** Кто вошёл, и кнопка выхода. */
export function UserBar({ user }: { user: AuthUser }) {
  const logout = useLogout();

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

import { Link } from 'react-router';
import { ChevronRightIcon, LogoutIcon } from '../../../shared/ui/icons.tsx';
import type { AuthUser } from '../../auth/api/auth.api.ts';
import { useLogout } from '../../auth/hooks/useAuth.ts';
import { useGroup } from '../../group/hooks/useGroup.ts';

const CARD = 'overflow-hidden rounded-2xl bg-white shadow-sm dark:bg-zinc-900';

/** «Владелец группы «Семья»»: the name of the group is known only to its owner (and is cut when it does not fit). */
function OwnerLine() {
  const { data } = useGroup();
  const group = data?.group.name;
  return <>{group ? `Владелец группы «${group}»` : 'Владелец группы'}</>;
}

function roleLine(user: AuthUser) {
  if (user.role === 'owner')
    return user.isAdmin ? 'Администратор и владелец группы' : <OwnerLine />;
  if (user.isAdmin) return 'Администратор';
  return user.role === 'member' ? 'Участник группы' : '';
}

/** The profile row on top of the hub of a phone: a letter, the name, the role; it opens «Аккаунт». */
export function SettingsProfile({ user }: { user: AuthUser }) {
  return (
    <Link
      to="/settings/account"
      aria-label={`Профиль: ${user.displayName}`}
      className={`${CARD} flex items-center gap-3 px-4 py-3`}
    >
      <span
        aria-hidden="true"
        className="flex size-14 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-xl font-semibold text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300"
      >
        {user.displayName.trim().charAt(0).toUpperCase()}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-lg font-semibold">{user.displayName}</span>
        <span className="block truncate text-sm text-zinc-500 dark:text-zinc-400">
          {roleLine(user)}
        </span>
        <span className="block truncate text-sm text-zinc-500 dark:text-zinc-400">
          Имя, карта по умолчанию, пароль
        </span>
      </span>
      <span aria-hidden="true" className="text-zinc-400">
        <ChevronRightIcon />
      </span>
    </Link>
  );
}

/** The red «Выйти» row at the bottom of the hub: the same exit as in the user menu. */
export function SettingsLogout() {
  const logout = useLogout();
  return (
    <>
      <button
        type="button"
        onClick={() => logout.mutate()}
        disabled={logout.isPending}
        className={`${CARD} mt-6 flex min-h-14 w-full items-center gap-3 px-4 text-left text-base font-medium text-red-600 disabled:opacity-60 dark:text-red-400`}
      >
        <LogoutIcon />
        Выйти
      </button>
      {logout.isError && (
        <p role="alert" className="px-4 pt-2 text-sm text-red-600 dark:text-red-400">
          Не удалось выйти
        </p>
      )}
    </>
  );
}

import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router';
import {
  ChevronDownIcon,
  LogoutIcon,
  SettingsIcon,
  ShieldIcon,
  UsersIcon,
} from '../../../shared/ui/icons.tsx';
import { hasBackupProblem, useAdminBackup } from '../../admin/hooks/useAdminBackup.ts';
import type { AuthUser } from '../api/auth.api.ts';
import { useLogout } from '../hooks/useAuth.ts';

const roleLabel = (user: AuthUser) =>
  user.isAdmin ? 'Администратор' : user.role === 'owner' ? 'Владелец' : 'Участник';

const itemClass =
  'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm text-zinc-700 ' +
  'hover:bg-zinc-100 focus-visible:bg-zinc-100 focus-visible:outline-none disabled:opacity-60 ' +
  'dark:text-zinc-200 dark:hover:bg-zinc-800 dark:focus-visible:bg-zinc-800';

/** A red dot on a control: something needs the administrator's attention. */
function ProblemDot({ className }: { className: string }) {
  return (
    <>
      <span aria-hidden="true" className={`absolute size-2 rounded-full bg-red-500 ${className}`} />
      <span className="sr-only">есть проблема с бэкапом</span>
    </>
  );
}

function MenuItem({ to, icon, children }: { to: string; icon: ReactNode; children: ReactNode }) {
  return (
    <Link to={to} role="menuitem" className={itemClass}>
      <span className="text-zinc-500 dark:text-zinc-400">{icon}</span>
      {children}
    </Link>
  );
}

/**
 * The user menu: the name (a letter on a phone) with a dropdown: role, group management (owner), administration
 * (admin), settings and sign-out. Closes on Escape, on a click outside and on a route change.
 */
export function UserBar({ user }: { user: AuthUser }) {
  const logout = useLogout();
  // Only an application admin asks about the backup: nobody else ever requests the endpoint
  const backup = useAdminBackup(user.isAdmin);
  const problem = user.isAdmin && hasBackupProblem(backup.data?.state);
  const { pathname } = useLocation();

  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  const close = (restoreFocus = false) => {
    setOpen(false);
    if (restoreFocus) button.current?.focus();
  };

  // A new page: the menu is not needed any more
  useEffect(() => setOpen(false), [pathname]);

  useEffect(() => {
    if (!open) return;
    const items = () =>
      root.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])');
    items()?.[0]?.focus();
    const onPointer = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    return () => document.removeEventListener('pointerdown', onPointer);
  }, [open]);

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') return close(true);
    const keys = ['ArrowDown', 'ArrowUp', 'Home', 'End'];
    if (!keys.includes(event.key)) return;
    const items = [...(root.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    if (items.length === 0) return;
    event.preventDefault();
    const index = items.indexOf(document.activeElement as HTMLElement);
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? items.length - 1
          : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items[next]?.focus();
  };

  return (
    <div ref={root} className="relative" onKeyDown={onKeyDown}>
      <button
        ref={button}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Меню пользователя: ${user.displayName}`}
        onClick={() => (open ? close() : setOpen(true))}
        className="relative flex h-10 items-center gap-1.5 rounded-full px-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-200/60 sm:px-3 dark:text-zinc-200 dark:hover:bg-zinc-800"
      >
        <span
          aria-hidden="true"
          className="flex size-8 items-center justify-center rounded-full bg-indigo-100 text-sm font-semibold text-indigo-700 sm:hidden dark:bg-indigo-950 dark:text-indigo-300"
        >
          {user.displayName.trim().charAt(0).toUpperCase()}
        </span>
        <span aria-hidden="true" className="hidden max-w-40 truncate sm:inline">
          {user.displayName}
        </span>
        <ChevronDownIcon />
        {problem && <ProblemDot className="right-0.5 top-1" />}
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Меню пользователя"
          className="absolute right-0 z-40 mt-2 w-64 max-w-[calc(100vw-2rem)] rounded-xl border border-zinc-200 bg-white p-1.5 shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
        >
          <div className="px-3 py-2">
            <div className="truncate font-semibold">{user.displayName}</div>
            <div className="text-xs text-zinc-500 dark:text-zinc-400">{roleLabel(user)}</div>
          </div>
          <div className="my-1 border-t border-zinc-100 dark:border-zinc-800" />
          {user.role === 'owner' && (
            <MenuItem to="/group" icon={<UsersIcon />}>
              Управление группой
            </MenuItem>
          )}
          {user.isAdmin && (
            <MenuItem to="/admin" icon={<ShieldIcon />}>
              <span className="relative">
                Админ
                {problem && <ProblemDot className="-right-3 top-0" />}
              </span>
            </MenuItem>
          )}
          <MenuItem to="/settings" icon={<SettingsIcon />}>
            Настройки
          </MenuItem>
          <button
            type="button"
            role="menuitem"
            onClick={() => logout.mutate()}
            disabled={logout.isPending}
            className={itemClass}
          >
            <span className="text-zinc-500 dark:text-zinc-400">
              <LogoutIcon />
            </span>
            Выйти
          </button>
          {logout.isError && (
            <p role="alert" className="px-3 py-2 text-xs text-red-600 dark:text-red-400">
              Не удалось выйти
            </p>
          )}
        </div>
      )}
    </div>
  );
}

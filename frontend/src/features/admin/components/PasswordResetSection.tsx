import { useState, type FormEvent } from 'react';
import { ApiError } from '../../../shared/api/http.ts';
import { MailIcon } from '../../../shared/ui/icons.tsx';
import { Notice } from '../../../shared/ui/Notice.tsx';
import { LinkPanel } from '../../group/components/LinkPanel.tsx';
import { compactInputClass } from '../../group/components/styles.ts';
import { toErrorMessage } from '../../group/model/error-message.ts';
import { SettingsSection } from '../../settings/components/SettingsSection.tsx';
import { createUserResetLink } from '../api/admin.api.ts';
import { useAdminMutation } from '../hooks/useAdminMutation.ts';

type ResetLink = { username: string; token: string; expiresAt: string };

/** A password reset link for any user by login. */
export function PasswordResetSection() {
  const [username, setUsername] = useState('');
  const [link, setLink] = useState<ResetLink | null>(null);
  const create = useAdminMutation(createUserResetLink, (issued, login) =>
    setLink({ username: login, ...issued }),
  );

  function submit(event: FormEvent) {
    event.preventDefault();
    const login = username.trim();
    if (!login || create.isPending) return;
    setLink(null);
    create.mutate(login);
  }

  const notFound = create.error instanceof ApiError && create.error.status === 404;

  return (
    <SettingsSection
      title="Сброс пароля"
      hint="Одноразовая ссылка для любого пользователя, который забыл пароль и которому не может помочь владелец группы."
    >
      <form onSubmit={submit} className="space-y-2">
        <div className="relative">
          <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-zinc-400">
            <MailIcon />
          </span>
          <input
            aria-label="Логин пользователя"
            placeholder="Логин"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            className={`${compactInputClass} w-full pl-10`}
          />
        </div>
        <button
          type="submit"
          disabled={create.isPending || username.trim() === ''}
          className="h-11 w-full rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:bg-zinc-200 disabled:text-zinc-400 dark:disabled:bg-zinc-800 dark:disabled:text-zinc-500"
        >
          Создать ссылку для сброса пароля
        </button>
      </form>
      {link && (
        <LinkPanel
          title={`Ссылка для нового пароля: ${link.username}`}
          token={link.token}
          expiresAt={link.expiresAt}
          onClose={() => setLink(null)}
        />
      )}
      {create.isError && (
        <Notice variant="error">
          {notFound ? 'Пользователь не найден' : toErrorMessage(create.error)}
        </Notice>
      )}
    </SettingsSection>
  );
}

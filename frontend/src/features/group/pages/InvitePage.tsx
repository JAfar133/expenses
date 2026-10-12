import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router';
import { ApiError, NETWORK_ERROR_CODE } from '../../../shared/api/http.ts';
import { Button } from '../../../shared/ui/Button.tsx';
import { Field, inputClassName } from '../../../shared/ui/Field.tsx';
import { Notice } from '../../../shared/ui/Notice.tsx';
import { fetchCurrentUser } from '../../auth/api/auth.api.ts';
import { resetCacheFor } from '../../auth/hooks/useAuth.ts';
import {
  acceptInvitation,
  fetchInvitation,
  type InvitationPreview,
} from '../api/invitations.api.ts';
import { toErrorMessage } from '../model/error-message.ts';

const noInputAssist = { autoCapitalize: 'none', autoCorrect: 'off', spellCheck: false } as const;

/** Public page: accept an invitation (join a group) or set a new password by a reset link. */
export default function InvitePage() {
  const { token = '' } = useParams();
  const preview = useQuery({
    queryKey: ['invitation', token],
    queryFn: () => fetchInvitation(token),
    retry: false,
    staleTime: Infinity,
  });

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[420px] flex-col justify-center px-4 pb-[max(2rem,env(safe-area-inset-bottom))] pt-[max(1.5rem,env(safe-area-inset-top))]">
      <h1 className="mb-6 text-center text-2xl font-bold">💳 Мои расходы</h1>
      <section className="rounded-2xl bg-white p-5 shadow-sm dark:bg-zinc-900">
        {preview.isPending && (
          <p role="status" className="text-center text-zinc-500">
            Загрузка…
          </p>
        )}
        {preview.isError && (
          <p role="alert" className="text-center text-zinc-600 dark:text-zinc-300">
            {preview.error instanceof ApiError && preview.error.code === NETWORK_ERROR_CODE
              ? 'Не удалось связаться с сервером. Проверьте соединение'
              : 'Приглашение недействительно или истекло. Попросите новую ссылку.'}
          </p>
        )}
        {preview.data && <InviteForm token={token} preview={preview.data} />}
      </section>
    </main>
  );
}

function InviteForm({ token, preview }: { token: string; preview: InvitationPreview }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const isJoin = preview.kind === 'join';
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [touched, setTouched] = useState(false);

  const accept = useMutation({
    retry: false,
    mutationFn: () =>
      acceptInvitation(
        token,
        isJoin
          ? {
              username: username.trim(),
              ...(displayName.trim() ? { displayName: displayName.trim() } : {}),
              password,
            }
          : { password },
      ),
    onSuccess: async () => {
      // The server has signed the person in: load them and open the app
      resetCacheFor(queryClient, await fetchCurrentUser());
      void navigate('/', { replace: true });
    },
  });

  const mismatch = password !== repeat;
  const missing = password === '' || (isJoin && username.trim() === '');

  function submit(event: FormEvent) {
    event.preventDefault();
    setTouched(true);
    if (missing || mismatch || accept.isPending) return;
    accept.mutate();
  }

  return (
    <>
      <h2 className="mb-5 text-lg font-semibold">
        {isJoin
          ? `Приглашение в группу «${preview.groupName ?? ''}»`
          : `Новый пароль для ${preview.username ?? ''}`}
      </h2>
      <form onSubmit={submit} noValidate className="space-y-5">
        {isJoin && (
          <>
            <Field label="Логин" htmlFor="invite-username">
              <input
                id="invite-username"
                autoComplete="username"
                {...noInputAssist}
                className={inputClassName}
                value={username}
                onChange={(event) => setUsername(event.target.value)}
              />
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                латиница, цифры, . - _ ; 3–32 символа
              </p>
            </Field>
            <Field label="Имя" htmlFor="invite-name">
              <input
                id="invite-name"
                autoComplete="name"
                className={inputClassName}
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
              />
            </Field>
          </>
        )}
        <Field label="Пароль" htmlFor="invite-password">
          <input
            id="invite-password"
            type="password"
            autoComplete="new-password"
            className={inputClassName}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </Field>
        <Field
          label="Повторите пароль"
          htmlFor="invite-repeat"
          error={touched && mismatch ? 'Пароли не совпадают' : undefined}
        >
          <input
            id="invite-repeat"
            type="password"
            autoComplete="new-password"
            className={inputClassName}
            value={repeat}
            onChange={(event) => setRepeat(event.target.value)}
            aria-invalid={touched && mismatch}
          />
        </Field>
        {touched && missing && <Notice variant="error">Заполните все поля</Notice>}
        {accept.isError && <Notice variant="error">{toErrorMessage(accept.error)}</Notice>}
        <Button type="submit" loading={accept.isPending}>
          {isJoin ? 'Присоединиться' : 'Сохранить пароль'}
        </Button>
      </form>
    </>
  );
}

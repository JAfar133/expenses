import { useState, type FormEvent } from 'react';
import { ApiError, NETWORK_ERROR_CODE } from '../../../shared/api/http.ts';
import { Button } from '../../../shared/ui/Button.tsx';
import { Field, inputClassName } from '../../../shared/ui/Field.tsx';
import { Notice } from '../../../shared/ui/Notice.tsx';
import { useLogin } from '../hooks/useAuth.ts';

function toLoginErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === NETWORK_ERROR_CODE)
      return 'Не удалось связаться с сервером. Проверьте соединение';
    // Сервер сам объясняет неверный пароль и блокировку из-за частых попыток
    if (error.code === 'INVALID_CREDENTIALS' || error.code === 'TOO_MANY_ATTEMPTS')
      return error.message;
  }
  return 'Не удалось войти. Попробуйте позже';
}

export function LoginPage() {
  const login = useLogin();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [touched, setTouched] = useState(false);

  const canSubmit = username.trim() !== '' && password !== '';

  function submit(event: FormEvent) {
    event.preventDefault();
    setTouched(true);
    if (!canSubmit || login.isPending) return;
    login.mutate({ username: username.trim(), password });
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[420px] flex-col justify-center px-4 pb-[max(2rem,env(safe-area-inset-bottom))] pt-[max(1.5rem,env(safe-area-inset-top))]">
      <h1 className="mb-6 text-center text-2xl font-bold">💳 Мои расходы</h1>

      <section className="rounded-2xl bg-white p-5 shadow-sm dark:bg-zinc-900">
        <h2 className="mb-5 text-lg font-semibold">Вход</h2>

        <form onSubmit={submit} noValidate className="space-y-5">
          <Field
            label="Логин"
            htmlFor="username"
            error={touched && username.trim() === '' ? 'Введите логин' : undefined}
          >
            <input
              id="username"
              name="username"
              type="text"
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              autoFocus
              className={inputClassName}
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              aria-invalid={touched && username.trim() === ''}
            />
          </Field>

          <Field
            label="Пароль"
            htmlFor="password"
            error={touched && password === '' ? 'Введите пароль' : undefined}
          >
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              className={inputClassName}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              aria-invalid={touched && password === ''}
            />
          </Field>

          {login.isError && <Notice variant="error">{toLoginErrorMessage(login.error)}</Notice>}

          <Button type="submit" loading={login.isPending}>
            {login.isPending ? 'Входим…' : 'Войти'}
          </Button>
        </form>
      </section>
    </main>
  );
}

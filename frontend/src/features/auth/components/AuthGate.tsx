import { useQueryClient } from '@tanstack/react-query';
import { useEffect, type ReactNode } from 'react';
import { onSessionLost } from '../../../shared/api/http.ts';
import { setAppTimezone } from '../../../shared/utils/date.ts';
import type { AuthUser } from '../api/auth.api.ts';
import { resetCacheFor, useCurrentUser } from '../hooks/useAuth.ts';
import { LoginPage } from './LoginPage.tsx';

/** Показывает приложение вошедшему пользователю, иначе форму входа. */
export function AuthGate({ children }: { children: (user: AuthUser) => ReactNode }) {
  const queryClient = useQueryClient();
  const current = useCurrentUser();

  // Если на любой запрос сервер ответил «войдите» и обновить вход не вышло, возвращаем форму входа
  useEffect(() => {
    onSessionLost(() => resetCacheFor(queryClient, null));
    return () => onSessionLost(undefined);
  }, [queryClient]);

  // «Сегодня» во всём приложении считается в часовом поясе пользователя; задаём его до отрисовки страниц
  setAppTimezone(current.data?.timezone);

  if (current.isPending) {
    return (
      <p role="status" className="py-20 text-center text-zinc-500">
        Загрузка…
      </p>
    );
  }

  if (current.isError) {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-[420px] flex-col justify-center gap-4 px-4">
        <Notice message="Не удалось связаться с сервером. Проверьте соединение" />
        <button
          type="button"
          onClick={() => void current.refetch()}
          className="h-12 w-full rounded-xl border border-zinc-300 text-base font-medium dark:border-zinc-700"
        >
          Повторить
        </button>
      </main>
    );
  }

  return current.data ? <>{children(current.data)}</> : <LoginPage />;
}

function Notice({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-red-800 dark:bg-red-950 dark:text-red-200"
    >
      {message}
    </div>
  );
}

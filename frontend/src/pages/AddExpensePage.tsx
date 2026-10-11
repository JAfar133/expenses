import type { AuthUser } from '../features/auth/api/auth.api.ts';
import { UserBar } from '../features/auth/components/UserBar.tsx';
import { ExpenseForm } from '../features/expenses/components/ExpenseForm.tsx';
import { useExpenseReference } from '../features/expenses/hooks/useExpenseReference.ts';
import { SyncIndicator } from '../features/sync/components/SyncIndicator.tsx';
import { Notice } from '../shared/ui/Notice.tsx';

export function AddExpensePage({ user }: { user: AuthUser }) {
  const reference = useExpenseReference();

  return (
    <main className="mx-auto min-h-dvh w-full max-w-[560px] px-4 pb-[max(2rem,env(safe-area-inset-bottom))] pt-[max(1.5rem,env(safe-area-inset-top))]">
      <header className="mb-6 flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">💳 Мои расходы</h1>
        <SyncIndicator />
      </header>

      <UserBar user={user} />

      <section className="rounded-2xl bg-white p-5 shadow-sm dark:bg-zinc-900">
        <h2 className="mb-5 text-lg font-semibold">Добавить расход</h2>

        {reference.data ? (
          <ExpenseForm {...reference.data} user={user} />
        ) : reference.isError ? (
          <div className="space-y-4">
            <Notice variant="error">Не удалось загрузить данные формы. Проверьте соединение</Notice>
            <button
              type="button"
              onClick={reference.refetch}
              className="h-12 w-full rounded-xl border border-zinc-300 text-base font-medium dark:border-zinc-700"
            >
              Повторить
            </button>
          </div>
        ) : (
          <p role="status" className="py-8 text-center text-zinc-500">
            Загрузка…
          </p>
        )}
      </section>
    </main>
  );
}

import { useState } from 'react';
import type { AuthUser } from '../features/auth/api/auth.api.ts';
import { ExpenseForm } from '../features/expenses/components/ExpenseForm.tsx';
import { useExpenseReference } from '../features/expenses/hooks/useExpenseReference.ts';
import { MonthSpent } from '../features/analytics/components/MonthSpent.tsx';
import { BudgetSummary } from '../features/budgets/components/BudgetSummary.tsx';
import { PendingExpenses } from '../features/offline-queue/components/PendingExpenses.tsx';
import type { QueuedExpense } from '../features/offline-queue/model/queue-types.ts';
import { Notice } from '../shared/ui/Notice.tsx';

export function AddExpensePage({ user }: { user: AuthUser }) {
  const reference = useExpenseReference();
  const [draft, setDraft] = useState<QueuedExpense>();

  return (
    <>
      <section className="rounded-2xl bg-white p-5 shadow-sm dark:bg-zinc-900">
        <h2 className="mb-5 text-lg font-semibold">Добавить расход</h2>

        <PendingExpenses onEdit={setDraft} />

        {reference.data ? (
          <ExpenseForm
            {...reference.data}
            user={user}
            draft={draft}
            onDraftApplied={() => setDraft(undefined)}
          />
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

      {reference.data && <MonthSpent currency={reference.data.currency} />}
      {reference.data && <BudgetSummary className="mt-4" />}
    </>
  );
}

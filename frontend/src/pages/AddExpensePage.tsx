import { useState } from 'react';
import type { AuthUser } from '../features/auth/api/auth.api.ts';
import { ExpenseForm } from '../features/expenses/components/ExpenseForm.tsx';
import { useExpenseReference } from '../features/expenses/hooks/useExpenseReference.ts';
import { MonthSpent } from '../features/analytics/components/MonthSpent.tsx';
import { BudgetSummary } from '../features/budgets/components/BudgetSummary.tsx';
import { ParseNotices } from '../features/ai/components/ParseNotices.tsx';
import { PendingExpenses } from '../features/offline-queue/components/PendingExpenses.tsx';
import type { QueuedExpense } from '../features/offline-queue/model/queue-types.ts';
import { Notice } from '../shared/ui/Notice.tsx';
import { BoltIcon } from '../shared/ui/icons.tsx';
import type { CreatedExpense } from '../features/expenses/api/expenses.api.ts';
import { useBooleanPreference } from '../features/preferences/hooks/usePreferences.ts';
import type { Template } from '../features/templates/api/templates.api.ts';
import {
  TemplateDialog,
  type TemplateDraft,
} from '../features/templates/components/TemplateDialog.tsx';
import { TemplateNotice } from '../features/templates/components/TemplateNotice.tsx';
import { TemplateStrip } from '../features/templates/components/TemplateStrip.tsx';
import { TemplatesSheet } from '../features/templates/components/TemplatesSheet.tsx';
import { useApplyTemplate } from '../features/templates/hooks/useApplyTemplate.ts';
import { useTemplates } from '../features/templates/hooks/useTemplates.ts';
import { hasTemplateFor, usableTemplates } from '../features/templates/model/available.ts';

export function AddExpensePage({ user }: { user: AuthUser }) {
  const reference = useExpenseReference();
  const [draft, setDraft] = useState<QueuedExpense>();
  const templates = useTemplates();
  const [hideGroup] = useBooleanPreference('templates.hideGroup', false);
  const [strip] = useBooleanPreference('templates.strip', true);
  const usable = usableTemplates(templates.data ?? [], hideGroup);
  // A template to put into the form, the list of all of them, and the dialog «Сохранить как шаблон»
  const [fill, setFill] = useState<Template>();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [saving, setSaving] = useState<TemplateDraft>();
  const applying = useApplyTemplate(setFill);

  const saveAsTemplate = (created: CreatedExpense) =>
    setSaving({
      name: created.name,
      expenseName: created.name,
      category: created.category,
      card: created.card,
      amount: created.original?.amount ?? created.amount,
      currency: created.original?.currency ?? created.currency ?? undefined,
    });

  return (
    <>
      <section className="rounded-2xl bg-white p-5 shadow-sm dark:bg-zinc-900">
        <div className="mb-5 flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">Добавить расход</h2>
          {usable.length > 0 && !strip && (
            <button
              type="button"
              aria-label="Быстрые траты"
              onClick={() => setSheetOpen(true)}
              className="flex size-11 items-center justify-center rounded-full bg-indigo-50 text-indigo-700 hover:bg-indigo-100 dark:bg-indigo-950 dark:text-indigo-300"
            >
              <BoltIcon size={18} />
            </button>
          )}
        </div>

        <PendingExpenses onEdit={setDraft} />
        {usable.length > 0 && strip && (
          <TemplateStrip
            templates={usable}
            onApply={(template) => void applying.apply(template)}
            onOpenAll={() => setSheetOpen(true)}
          />
        )}

        {reference.data ? (
          <ExpenseForm
            {...reference.data}
            user={user}
            draft={draft}
            onDraftApplied={() => setDraft(undefined)}
            template={fill}
            onTemplateApplied={() => setFill(undefined)}
            templateOffer={{
              exists: (category, name) => hasTemplateFor(templates.data ?? [], category, name),
              onSave: saveAsTemplate,
            }}
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

      <div className="mt-4 space-y-2 empty:hidden">
        <ParseNotices />
      </div>

      {reference.data && <MonthSpent currency={reference.data.currency} />}
      {reference.data && <BudgetSummary className="mt-4" />}

      {applying.notice && (
        <TemplateNotice
          notice={applying.notice}
          onUndo={(id) => void applying.undo(id)}
          onDismiss={applying.dismiss}
        />
      )}
      {sheetOpen && (
        <TemplatesSheet
          templates={usable}
          onApply={(template) => void applying.apply(template)}
          onOpenInForm={setFill}
          onClose={() => setSheetOpen(false)}
        />
      )}
      {saving && <TemplateDialog draft={saving} onClose={() => setSaving(undefined)} />}
    </>
  );
}

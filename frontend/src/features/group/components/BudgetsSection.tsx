import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { PencilIcon, CloseIcon } from '../../../shared/ui/icons.tsx';
import { Notice } from '../../../shared/ui/Notice.tsx';
import { currencyDigits } from '../../../shared/utils/conversion.ts';
import { formatAmount, parseDecimal } from '../../../shared/utils/money.ts';
import { ConfirmDialog } from '../../analytics/components/ConfirmDialog.tsx';
import {
  createBudget,
  deleteBudget,
  updateBudget,
  type Budget,
  type BudgetInput,
  type PeriodKind,
} from '../../budgets/api/budgets.api.ts';
import { BUDGETS_KEY, useBudgets } from '../../budgets/hooks/useBudgets.ts';
import { useConfig } from '../../expenses/hooks/useConfig.ts';
import { SettingsSection } from '../../settings/components/SettingsSection.tsx';
import type { GroupCategory } from '../api/group.api.ts';
import { toErrorMessage } from '../model/error-message.ts';
import { ActionButton, ListRow, RowActions } from './ListRow.tsx';
import { compactInputClass, compactSelectClass, textButtonClass } from './styles.ts';

const PERIOD_LABELS: Record<PeriodKind, string> = {
  month: 'Календарный месяц',
  month_from_day: 'Месяц с N-го числа',
  week: 'Неделя',
};

const periodText = (budget: Budget) =>
  budget.periodKind === 'month'
    ? 'календарный месяц'
    : budget.periodKind === 'week'
      ? 'неделя'
      : `месяц с ${budget.periodDay}-го числа`;

interface FormValues {
  limit: string;
  periodKind: PeriodKind;
  periodDay: string;
}

/** The server payload for a limit's amount and period; a message if something is wrong. */
function toPayload(values: FormValues): {
  payload?: Pick<BudgetInput, 'limit' | 'periodKind' | 'periodDay'>;
  error?: string;
} {
  const limit = parseDecimal(values.limit);
  if (limit === null || limit <= 0) return { error: 'Введите лимит числом больше нуля' };
  if (values.periodKind !== 'month_from_day')
    return { payload: { limit, periodKind: values.periodKind } };
  const day = Number(values.periodDay);
  if (!Number.isInteger(day) || day < 1 || day > 28) return { error: 'Число месяца — от 1 до 28' };
  return { payload: { limit, periodKind: values.periodKind, periodDay: day } };
}

/** Amount and period fields shared by the add and edit forms. */
function LimitFields({
  values,
  onChange,
}: {
  values: FormValues;
  onChange: (next: FormValues) => void;
}) {
  return (
    <>
      <input
        aria-label="Сумма лимита"
        inputMode="decimal"
        placeholder="Сумма"
        value={values.limit}
        onChange={(event) => onChange({ ...values, limit: event.target.value })}
        className={`${compactInputClass} w-full sm:w-36 sm:flex-none`}
      />
      <select
        aria-label="Период лимита"
        value={values.periodKind}
        onChange={(event) => onChange({ ...values, periodKind: event.target.value as PeriodKind })}
        className={`${compactSelectClass} h-11 w-full sm:w-auto`}
      >
        {(Object.keys(PERIOD_LABELS) as PeriodKind[]).map((kind) => (
          <option key={kind} value={kind}>
            {PERIOD_LABELS[kind]}
          </option>
        ))}
      </select>
      {values.periodKind === 'month_from_day' && (
        <input
          aria-label="Число месяца"
          inputMode="numeric"
          placeholder="1–28"
          value={values.periodDay}
          onChange={(event) => onChange({ ...values, periodDay: event.target.value })}
          className={`${compactInputClass} w-full sm:w-24 sm:flex-none`}
        />
      )}
    </>
  );
}

const emptyValues = (): FormValues => ({ limit: '', periodKind: 'month', periodDay: '1' });

function BudgetRow({
  budget,
  money,
  currency,
  onSave,
  onDelete,
}: {
  budget: Budget;
  money: (value: number) => string;
  currency: string;
  onSave: (
    id: string,
    input: Pick<BudgetInput, 'limit' | 'periodKind' | 'periodDay'>,
  ) => Promise<unknown>;
  onDelete: (budget: Budget) => void;
}) {
  const label = budget.category ?? 'Всего';
  const [editing, setEditing] = useState(false);
  const [values, setValues] = useState<FormValues>(emptyValues);
  const [problem, setProblem] = useState<string>();

  const start = () => {
    setValues({
      limit: String(budget.limit).replace('.', ','),
      periodKind: budget.periodKind,
      periodDay: String(budget.periodDay ?? 1),
    });
    setProblem(undefined);
    setEditing(true);
  };

  async function submit(event: FormEvent) {
    event.preventDefault();
    const { payload, error } = toPayload(values);
    if (!payload) return setProblem(error);
    try {
      await onSave(budget.id, payload);
      setEditing(false);
    } catch {
      // The error is shown by the section; stay in the editor
    }
  }

  if (editing) {
    return (
      <li className="py-3">
        <p className="mb-2 text-sm font-medium">{label}</p>
        <form
          onSubmit={(event) => void submit(event)}
          className="grid gap-2 sm:flex sm:flex-wrap sm:items-center"
        >
          <LimitFields values={values} onChange={setValues} />
          <div className="grid grid-cols-2 gap-2 sm:flex">
            <button type="submit" className={textButtonClass}>
              Сохранить
            </button>
            <button type="button" onClick={() => setEditing(false)} className={textButtonClass}>
              Отмена
            </button>
          </div>
        </form>
        {problem && <p className="mt-1 text-sm text-red-600 dark:text-red-400">{problem}</p>}
      </li>
    );
  }

  return (
    <ListRow
      main={
        <>
          <span className="block font-medium">{label}</span>
          <span className="block text-xs text-zinc-500 dark:text-zinc-400">
            {money(budget.limit)} {currency} · {periodText(budget)}
          </span>
        </>
      }
    >
      <RowActions>
        <ActionButton label={`Изменить лимит: ${label}`} icon={<PencilIcon />} onClick={start} />
        <ActionButton
          label={`Удалить лимит: ${label}`}
          tone="danger"
          icon={<CloseIcon />}
          onClick={() => onDelete(budget)}
        />
      </RowActions>
    </ListRow>
  );
}

function AddLimitForm({
  options,
  busy,
  onAdd,
}: {
  options: { value: string; label: string }[];
  busy: boolean;
  onAdd: (input: BudgetInput) => Promise<unknown>;
}) {
  const [target, setTarget] = useState(options[0]?.value ?? '');
  const [values, setValues] = useState<FormValues>(emptyValues);
  const [problem, setProblem] = useState<string>();

  // The chosen target may disappear from the options after it got a limit
  const chosen = options.some((option) => option.value === target)
    ? target
    : (options[0]?.value ?? '');

  async function submit(event: FormEvent) {
    event.preventDefault();
    const { payload, error } = toPayload(values);
    if (!payload) return setProblem(error);
    setProblem(undefined);
    try {
      await onAdd({ categoryId: chosen === '' ? null : chosen, ...payload });
      setValues(emptyValues());
    } catch {
      // The error is shown by the section; keep the typed values
    }
  }

  return (
    <form
      onSubmit={(event) => void submit(event)}
      className="grid gap-2 sm:flex sm:flex-wrap sm:items-center"
    >
      <select
        aria-label="Для чего лимит"
        value={chosen}
        onChange={(event) => setTarget(event.target.value)}
        className={`${compactSelectClass} h-11 w-full sm:w-auto`}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <LimitFields values={values} onChange={setValues} />
      <button
        type="submit"
        disabled={busy}
        className="h-11 rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-60"
      >
        Добавить
      </button>
      {problem && <p className="text-sm text-red-600 dark:text-red-400">{problem}</p>}
    </form>
  );
}

/** Spending limits of the group (owner): per category or for the whole group, with a period of the owner's choice. */
export function BudgetsSection({ categories }: { categories: GroupCategory[] }) {
  const queryClient = useQueryClient();
  const budgets = useBudgets().data;
  const config = useConfig().data;
  const [deleting, setDeleting] = useState<Budget | null>(null);

  const refresh = () => queryClient.invalidateQueries({ queryKey: BUDGETS_KEY });
  const add = useMutation({ retry: false, mutationFn: createBudget, onSuccess: refresh });
  const save = useMutation({
    retry: false,
    mutationFn: ({
      id,
      input,
    }: {
      id: string;
      input: Pick<BudgetInput, 'limit' | 'periodKind' | 'periodDay'>;
    }) => updateBudget(id, input),
    onSuccess: refresh,
  });
  const remove = useMutation({ retry: false, mutationFn: deleteBudget, onSuccess: refresh });

  if (!budgets || !config) return null;
  const currency = config.currency;
  const digits = currencyDigits(currency, config.baseCurrency);
  const money = (value: number) => formatAmount(value, digits);

  const covered = new Set(budgets.map((budget) => budget.categoryId));
  const options = [
    ...(covered.has(null) ? [] : [{ value: '', label: 'Всего (на всю группу)' }]),
    ...categories
      .filter((category) => !category.archived && !covered.has(category.id))
      .map((category) => ({ value: category.id, label: category.name })),
  ];
  const failed = [add, save, remove].find((mutation) => mutation.isError);

  async function confirmDelete(budget: Budget) {
    try {
      await remove.mutateAsync(budget.id);
    } catch {
      // The error is shown below
    }
    setDeleting(null);
  }

  return (
    <SettingsSection
      title="Лимиты"
      hint="Лимит на категорию или на всю группу в валюте отчётности. Период можно выбрать: календарный месяц, месяц с выбранного числа или неделя. Участники видят полоски, но не меняют лимиты. Расход считается по тем картам, которые видит каждый. При смене валюты отчётности лимиты пересчитываются по курсу."
    >
      {budgets.length > 0 && (
        <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {budgets.map((budget) => (
            <BudgetRow
              key={budget.id}
              budget={budget}
              money={money}
              currency={currency}
              onSave={(id, input) => save.mutateAsync({ id, input })}
              onDelete={setDeleting}
            />
          ))}
        </ul>
      )}
      {options.length > 0 && (
        <AddLimitForm
          options={options}
          busy={add.isPending}
          onAdd={(input) => add.mutateAsync(input)}
        />
      )}
      {failed && <Notice variant="error">{toErrorMessage(failed.error)}</Notice>}
      {deleting && (
        <ConfirmDialog
          title="Удалить лимит?"
          message={`Лимит «${deleting.category ?? 'Всего'}» будет удалён. Траты останутся как были.`}
          confirmLabel="Удалить"
          busy={remove.isPending}
          onConfirm={() => void confirmDelete(deleting)}
          onCancel={() => setDeleting(null)}
        />
      )}
    </SettingsSection>
  );
}

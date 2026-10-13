import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Modal } from '../../../shared/ui/Modal.tsx';
import { Notice } from '../../../shared/ui/Notice.tsx';
import { todayIso } from '../../../shared/utils/date.ts';
import {
  formatAmountInput,
  formatDecimalInput,
  parseDecimal,
} from '../../../shared/utils/money.ts';
import { ChartTypeSwitch } from '../../analytics/components/ChartTypeSwitch.tsx';
import {
  createBudget,
  deleteBudget,
  updateBudget,
  type Budget,
  type BudgetInput,
} from '../../budgets/api/budgets.api.ts';
import { BUDGETS_KEY } from '../../budgets/hooks/useBudgets.ts';
import { periodFor, periodText } from '../../budgets/model/period.ts';
import { toErrorMessage } from '../model/error-message.ts';
import { compactInputClass } from './styles.ts';

type Mode = 'month' | 'week';

interface LimitDialogProps {
  /** «Все категории» or the category name */
  label: string;
  /** null: the overall limit of the group */
  categoryId: string | null;
  /** The current limit, if there is one */
  budget?: Budget;
  currency: string;
  /** Whole amounts (drams) or cents */
  digits: number;
  onClose: () => void;
}

const MODES = [
  { value: 'month', label: 'Месяц' },
  { value: 'week', label: 'Неделя' },
] as const;

/** Sets, changes or removes the limit of a category (or of the whole group): amount and period. */
export function LimitDialog({
  label,
  categoryId,
  budget,
  currency,
  digits,
  onClose,
}: LimitDialogProps) {
  const queryClient = useQueryClient();
  const formatAmount = (value: string) =>
    formatDecimalInput(value, { maxDecimals: 2, group: true });

  const [amount, setAmount] = useState(
    budget ? formatAmount(String(budget.limit).replace('.', ',')) : '',
  );
  const [mode, setMode] = useState<Mode>(budget?.periodKind === 'week' ? 'week' : 'month');
  const [day, setDay] = useState(String(budget?.periodDay ?? 1));
  const [problem, setProblem] = useState<string>();

  const refresh = () => queryClient.invalidateQueries({ queryKey: BUDGETS_KEY });
  const finish = async () => {
    await refresh();
    onClose();
  };
  const save = useMutation({
    retry: false,
    mutationFn: (input: BudgetInput) =>
      budget
        ? updateBudget(budget.id, {
            limit: input.limit,
            periodKind: input.periodKind,
            periodDay: input.periodDay,
          })
        : createBudget(input),
    onSuccess: finish,
  });
  const remove = useMutation({
    retry: false,
    mutationFn: () => deleteBudget(budget!.id),
    onSuccess: finish,
  });
  const busy = save.isPending || remove.isPending;

  // Month + day 1 is the calendar month; week ignores the day
  const dayNumber = Number(day);
  const dayValid = Number.isInteger(dayNumber) && dayNumber >= 1 && dayNumber <= 28;
  const kind = mode === 'week' ? 'week' : dayNumber > 1 ? 'month_from_day' : 'month';
  const preview = periodFor(kind, dayValid ? dayNumber : null, todayIso());

  function submit(event: FormEvent) {
    event.preventDefault();
    const limit = parseDecimal(amount);
    if (limit === null || limit <= 0) return setProblem('Введите сумму больше нуля');
    if (mode === 'month' && !dayValid) return setProblem('Число месяца — от 1 до 28');
    setProblem(undefined);
    save.mutate({
      categoryId,
      limit,
      periodKind: kind,
      ...(kind === 'month_from_day' ? { periodDay: dayNumber } : {}),
    });
  }

  const error = save.isError ? save.error : remove.isError ? remove.error : undefined;

  return (
    <Modal title={`Лимит: ${label}`} onClose={onClose}>
      <form onSubmit={submit} noValidate className="space-y-4">
        <div className="space-y-1.5">
          <label
            htmlFor="limit-amount"
            className="block text-sm font-medium text-zinc-600 dark:text-zinc-400"
          >
            Сумма
          </label>
          <div className="relative">
            <input
              id="limit-amount"
              type="text"
              inputMode="decimal"
              autoComplete="off"
              value={amount}
              onChange={(event) => setAmount(formatAmount(event.target.value))}
              className={`${compactInputClass} h-12 w-full pr-16`}
            />
            <span className="pointer-events-none absolute inset-y-0 right-4 flex items-center text-sm text-zinc-500">
              {currency}
            </span>
          </div>
        </div>

        <div className="space-y-1.5">
          <div className="text-sm font-medium text-zinc-600 dark:text-zinc-400">Период</div>
          <ChartTypeSwitch
            label="Период"
            options={MODES}
            value={mode}
            onChange={setMode}
            mobileColumns={2}
          />
        </div>

        {mode === 'month' ? (
          <div className="space-y-1.5">
            <label
              htmlFor="limit-day"
              className="block text-sm font-medium text-zinc-600 dark:text-zinc-400"
            >
              Месяц начинается
            </label>
            <div className="flex items-center gap-2">
              <input
                id="limit-day"
                type="text"
                inputMode="numeric"
                autoComplete="off"
                value={day}
                onChange={(event) => setDay(event.target.value.replace(/\D/g, '').slice(0, 2))}
                className={`${compactInputClass} h-12 w-20 flex-none text-center`}
              />
              <span className="text-sm text-zinc-600 dark:text-zinc-400">числа</span>
            </div>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">1 — календарный месяц</p>
          </div>
        ) : (
          <p className="text-xs text-zinc-500 dark:text-zinc-400">с понедельника по воскресенье</p>
        )}

        <p className="text-sm text-zinc-500 dark:text-zinc-400">Сейчас: {periodText(preview)}</p>

        {problem && <p className="text-sm text-red-600 dark:text-red-400">{problem}</p>}
        {error != null && <Notice variant="error">{toErrorMessage(error)}</Notice>}

        <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:items-center">
          {budget && (
            <button
              type="button"
              disabled={busy}
              onClick={() => remove.mutate()}
              className="h-11 rounded-xl px-4 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-60 sm:mr-auto dark:text-red-400 dark:hover:bg-red-950"
            >
              Убрать лимит
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="h-11 rounded-xl border border-zinc-300 px-4 text-sm font-medium dark:border-zinc-700 sm:ml-auto"
          >
            Отмена
          </button>
          <button
            type="submit"
            disabled={busy}
            aria-busy={save.isPending}
            className="h-11 rounded-xl bg-indigo-600 px-5 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-60"
          >
            Сохранить
          </button>
        </div>
      </form>
    </Modal>
  );
}

import { useState, type FormEvent } from 'react';
import { Field, inputClassName } from '../../../shared/ui/Field.tsx';
import { Modal } from '../../../shared/ui/Modal.tsx';
import { Notice } from '../../../shared/ui/Notice.tsx';
import { formatAmountInput, formatMoney, parseAmount } from '../../../shared/utils/money.ts';
import { toSaveErrorMessage } from '../../expenses/api/save-error-message.ts';
import type { ExpensePatch, OperationItem } from '../api/operations.api.ts';

interface EditExpenseDialogProps {
  item: OperationItem;
  cards: string[];
  categories: string[];
  currency: string;
  /** Saving in progress */
  saving: boolean;
  /** Error of the last save */
  error: unknown;
  onSave: (patch: ExpensePatch) => void;
  onClose: () => void;
}

/** Form values to a patch: only what actually changed. */
export function buildPatch(
  item: OperationItem,
  values: { date: string; card: string; category: string; name: string; amount: string },
): { patch: ExpensePatch; errors: Partial<Record<keyof typeof values, string>> } {
  const errors: Partial<Record<keyof typeof values, string>> = {};
  const patch: ExpensePatch = {};

  if (!values.date) errors.date = 'Укажите дату';
  else if (values.date !== item.date) patch.date = values.date;

  if (!values.card) errors.card = 'Выберите карту';
  else if (values.card !== item.card) patch.card = values.card;

  if (!values.category) errors.category = 'Выберите категорию';
  else if (values.category !== item.category) patch.category = values.category;

  const name = values.name.trim();
  if (!name) errors.name = 'Введите наименование';
  else if (name !== item.name) patch.name = name;

  const amount = parseAmount(values.amount);
  if (!values.amount.trim()) errors.amount = 'Введите стоимость';
  else if (amount === null) errors.amount = 'Введите целое число';
  else if (amount <= 0) errors.amount = 'Стоимость должна быть больше нуля';
  else if (amount !== item.amount) patch.amount = amount;

  return { patch, errors };
}

/** Record edit: date, card, category, name and cost in drams. Only changed fields are sent. */
export function EditExpenseDialog({
  item,
  cards,
  categories,
  currency,
  saving,
  error,
  onSave,
  onClose,
}: EditExpenseDialogProps) {
  const [values, setValues] = useState({
    date: item.date,
    card: item.card,
    category: item.category,
    name: item.name,
    amount: formatAmountInput(String(item.amount)),
  });
  const [submitted, setSubmitted] = useState(false);

  const { patch, errors } = buildPatch(item, values);
  const changed = Object.keys(patch).length > 0;
  const invalid = Object.keys(errors).length > 0;
  const shown = submitted ? errors : {};
  const set = (field: keyof typeof values) => (value: string) =>
    setValues((current) => ({ ...current, [field]: value }));

  // A selected value missing from the reference data (e.g. an old card) stays available
  const withCurrent = (options: string[], current: string) =>
    options.includes(current) ? options : [current, ...options];

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setSubmitted(true);
    if (!invalid && changed) onSave(patch);
  };

  return (
    <Modal title="Изменить запись" onClose={onClose}>
      <form onSubmit={submit} noValidate className="space-y-4">
        <Field label="Дата" htmlFor="edit-date" error={shown.date}>
          <input
            id="edit-date"
            type="date"
            className={inputClassName}
            value={values.date}
            aria-invalid={!!shown.date}
            onChange={(event) => set('date')(event.target.value)}
          />
        </Field>

        <Field label="Карта" htmlFor="edit-card" error={shown.card}>
          <select
            id="edit-card"
            className={inputClassName}
            value={values.card}
            onChange={(event) => set('card')(event.target.value)}
          >
            {withCurrent(cards, item.card).map((card) => (
              <option key={card} value={card}>
                {card}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Категория" htmlFor="edit-category" error={shown.category}>
          <select
            id="edit-category"
            className={inputClassName}
            value={values.category}
            onChange={(event) => set('category')(event.target.value)}
          >
            {withCurrent(categories, item.category).map((category) => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Наименование" htmlFor="edit-name" error={shown.name}>
          <input
            id="edit-name"
            type="text"
            autoComplete="off"
            maxLength={255}
            className={inputClassName}
            value={values.name}
            aria-invalid={!!shown.name}
            onChange={(event) => set('name')(event.target.value)}
          />
        </Field>

        <Field label={`Стоимость, ${currency}`} htmlFor="edit-amount" error={shown.amount}>
          <input
            id="edit-amount"
            type="text"
            inputMode="numeric"
            autoComplete="off"
            className={inputClassName}
            value={values.amount}
            aria-invalid={!!shown.amount}
            onChange={(event) => set('amount')(formatAmountInput(event.target.value))}
          />
        </Field>

        {item.original && 'amount' in patch && (
          <Notice variant="info">
            Исходная сумма ({formatMoney(item.original.amount)} {item.original.currency} по курсу{' '}
            {formatMoney(item.original.rate, 6)}) будет сброшена: стоимость задана в {currency}
          </Notice>
        )}
        {error != null && <Notice variant="error">{toSaveErrorMessage(error)}</Notice>}

        <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="h-11 rounded-xl border border-zinc-300 px-4 text-sm font-medium dark:border-zinc-700"
          >
            Отмена
          </button>
          <button
            type="submit"
            // Disabled while nothing changed; enabled with errors: pressing shows what to fix
            disabled={saving || (!changed && !invalid)}
            aria-busy={saving}
            className="h-11 rounded-xl bg-indigo-600 px-5 text-sm font-semibold text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saving ? 'Сохраняем…' : 'Сохранить'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

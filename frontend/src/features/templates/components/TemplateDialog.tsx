import { useState, type FormEvent } from 'react';
import { ApiError } from '../../../shared/api/http.ts';
import { Field, inputClassName } from '../../../shared/ui/Field.tsx';
import { Modal } from '../../../shared/ui/Modal.tsx';
import { Notice } from '../../../shared/ui/Notice.tsx';
import { SelectBox, selectPadding } from '../../../shared/ui/SelectBox.tsx';
import { Switch } from '../../../shared/ui/Switch.tsx';
import { formatDecimalInput, parseDecimal } from '../../../shared/utils/money.ts';
import { useCurrentUser } from '../../auth/hooks/useAuth.ts';
import { useExpenseReference } from '../../expenses/hooks/useExpenseReference.ts';
import { useRates } from '../../expenses/hooks/useRates.ts';
import type { TemplateInput, TemplateScope } from '../api/templates.api.ts';
import { EmojiPicker } from './EmojiPicker.tsx';
import { useTemplateActions } from '../hooks/useTemplates.ts';
import { shortDate } from '../model/available.ts';

/** What the dialog starts from: a blank template, an operation, or the template being edited. */
export interface TemplateDraft extends Partial<TemplateInput> {
  /** The template being edited; none: a new one */
  id?: string;
  /** Who changed the template last, and when (a group template being edited) */
  updatedBy?: string | null;
  updatedAt?: string | null;
}

const SCOPES: { value: TemplateScope; label: string }[] = [
  { value: 'personal', label: 'Только мне' },
  { value: 'group', label: 'Группе' },
];

/** Create or edit a template. The fields start from `draft` (for «Сохранить как шаблон» it is the operation). */
export function TemplateDialog({
  draft,
  onClose,
  onSaved,
  fixedScope,
}: {
  draft: TemplateDraft;
  /** The scope is not chosen: the group page creates group templates only */
  fixedScope?: TemplateScope;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const { data: user } = useCurrentUser();
  const reference = useExpenseReference();
  const rates = useRates();
  const { create, update } = useTemplateActions();
  const editing = draft.id !== undefined;
  // Only the owner of the group creates a group template; a member proposes a personal one from the settings.
  // Where a template lives never changes when it is edited.
  const chooseScope = !editing && !fixedScope && user?.role === 'owner';
  const cards = reference.data?.cards ?? [];
  const categories = reference.data?.categories ?? [];
  const baseCurrency = reference.data?.baseCurrency ?? 'AMD';
  const currencies = [
    ...new Set([
      ...(draft.currency ? [draft.currency] : []),
      baseCurrency,
      ...(rates.data?.currencies ?? []),
    ]),
  ];

  const [name, setName] = useState(draft.name ?? '');
  const [emoji, setEmoji] = useState(draft.emoji ?? '');
  const [category, setCategory] = useState(draft.category ?? '');
  const [card, setCard] = useState(draft.card ?? '');
  const [expenseName, setExpenseName] = useState(draft.expenseName ?? draft.name ?? '');
  const [keepAmount, setKeepAmount] = useState(draft.amount != null);
  const [amount, setAmount] = useState(
    draft.amount != null
      ? formatDecimalInput(String(draft.amount), { maxDecimals: 2, group: true })
      : '',
  );
  const [currency, setCurrency] = useState(draft.currency ?? baseCurrency);
  const [scope, setScope] = useState<TemplateScope>(fixedScope ?? draft.scope ?? 'personal');
  const [errors, setErrors] = useState<Record<string, string>>({});

  const mutation = editing ? update : create;
  const serverError =
    mutation.error instanceof ApiError
      ? mutation.error.message
      : mutation.error && 'Не удалось сохранить шаблон';

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const parsed = parseDecimal(amount);
    const found: Record<string, string> = {};
    if (!name.trim()) found.name = 'Введите название кнопки';
    if (!category) found.category = 'Выберите категорию';
    if (!expenseName.trim()) found.expenseName = 'Введите наименование';
    if (keepAmount && (parsed === null || parsed <= 0)) found.amount = 'Введите сумму больше нуля';
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    const input: TemplateInput = {
      scope,
      name: name.trim(),
      emoji: emoji.trim() || null,
      category,
      card: card || null,
      expenseName: expenseName.trim(),
      amount: keepAmount ? parsed : null,
      currency: keepAmount ? currency : null,
    };
    const done = { onSuccess: () => (onSaved?.(), onClose()) };
    if (editing) update.mutate({ id: draft.id!, input }, done);
    else create.mutate(input, done);
  };

  return (
    <Modal title={editing ? 'Изменить шаблон' : 'Новый шаблон'} onClose={onClose}>
      <form onSubmit={submit} noValidate className="space-y-4 pb-1">
        {(editing ? draft.scope : fixedScope) === 'group' && (
          <p className="-mt-2 text-xs text-zinc-500 dark:text-zinc-400">
            Групповой шаблон: изменения увидит вся группа
            {editing && draft.updatedBy && (
              <>
                <br />
                Изменил {draft.updatedBy}
                {draft.updatedAt ? `, ${shortDate(draft.updatedAt)}` : ''}
              </>
            )}
          </p>
        )}
        <Field label="Название кнопки" htmlFor="template-name" error={errors.name}>
          <input
            id="template-name"
            className={inputClassName}
            value={name}
            maxLength={40}
            aria-invalid={!!errors.name}
            onChange={(event) => setName(event.target.value)}
          />
        </Field>
        <Field label="Эмодзи (необязательно)" htmlFor="template-emoji">
          <EmojiPicker id="template-emoji" value={emoji} onChange={setEmoji} />
        </Field>
        <Field label="Категория" htmlFor="template-category" error={errors.category}>
          <SelectBox>
            <select
              id="template-category"
              className={`${inputClassName} ${selectPadding}`}
              value={category}
              aria-invalid={!!errors.category}
              onChange={(event) => setCategory(event.target.value)}
            >
              <option value="" disabled>
                Не выбрана
              </option>
              {categories.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </SelectBox>
        </Field>
        <Field label="Карта" htmlFor="template-card">
          <SelectBox>
            <select
              id="template-card"
              className={`${inputClassName} ${selectPadding}`}
              value={card}
              onChange={(event) => setCard(event.target.value)}
            >
              <option value="">Моя карта по умолчанию</option>
              {cards.map((item) => (
                <option key={item.name} value={item.name}>
                  {item.name} · {item.currency}
                </option>
              ))}
            </select>
          </SelectBox>
        </Field>
        <Field
          label="Наименование расхода"
          htmlFor="template-expense-name"
          error={errors.expenseName}
        >
          <input
            id="template-expense-name"
            className={inputClassName}
            value={expenseName}
            maxLength={255}
            aria-invalid={!!errors.expenseName}
            onChange={(event) => setExpenseName(event.target.value)}
          />
        </Field>

        <div className="flex items-center justify-between gap-3">
          <span className="text-sm font-medium">Сохранить сумму</span>
          <Switch checked={keepAmount} label="Сохранить сумму" onChange={setKeepAmount} />
        </div>
        {keepAmount && (
          <div className="grid grid-cols-[1fr_auto] gap-2">
            <Field label="Сумма" htmlFor="template-amount" error={errors.amount}>
              <input
                id="template-amount"
                inputMode="decimal"
                autoComplete="off"
                className={inputClassName}
                value={amount}
                aria-invalid={!!errors.amount}
                onChange={(event) =>
                  setAmount(formatDecimalInput(event.target.value, { maxDecimals: 2, group: true }))
                }
              />
            </Field>
            <Field label="Валюта" htmlFor="template-currency">
              <SelectBox>
                <select
                  id="template-currency"
                  className={`${inputClassName} ${selectPadding}`}
                  value={currency}
                  onChange={(event) => setCurrency(event.target.value)}
                >
                  {currencies.map((code) => (
                    <option key={code} value={code}>
                      {code}
                    </option>
                  ))}
                </select>
              </SelectBox>
            </Field>
          </div>
        )}

        {chooseScope && (
          <fieldset className="space-y-1.5">
            <legend className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
              Кому виден
            </legend>
            <div role="radiogroup" className="flex rounded-xl bg-zinc-100 p-1 dark:bg-zinc-800">
              {SCOPES.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={scope === option.value}
                  onClick={() => setScope(option.value)}
                  className={
                    'h-10 flex-1 rounded-lg text-sm font-medium transition ' +
                    (scope === option.value
                      ? 'bg-white text-zinc-900 shadow-sm dark:bg-zinc-950 dark:text-zinc-50'
                      : 'text-zinc-500 dark:text-zinc-400')
                  }
                >
                  {option.label}
                </button>
              ))}
            </div>
          </fieldset>
        )}

        {serverError && <Notice variant="error">{serverError}</Notice>}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            className="h-11 rounded-xl border border-zinc-300 px-4 text-sm font-medium dark:border-zinc-700"
          >
            Отмена
          </button>
          <button
            type="submit"
            disabled={mutation.isPending}
            className="h-11 rounded-xl bg-indigo-600 px-5 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-60"
          >
            Сохранить
          </button>
        </div>
      </form>
    </Modal>
  );
}

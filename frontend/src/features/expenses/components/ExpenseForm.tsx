import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useMemo, useRef } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import type { AuthUser } from '../../auth/api/auth.api.ts';
import { Button } from '../../../shared/ui/Button.tsx';
import { Field, inputClassName } from '../../../shared/ui/Field.tsx';
import { Notice } from '../../../shared/ui/Notice.tsx';
import { todayIso } from '../../../shared/utils/date.ts';
import { formatMoney, parseAmount, parseDecimal } from '../../../shared/utils/money.ts';
import { newRequestId } from '../../../shared/utils/request-id.ts';
import { readStored, writeStored } from '../../../shared/utils/storage.ts';
import type { CreatedExpense, NameSuggestion } from '../api/expenses.api.ts';
import { toSaveErrorMessage } from '../api/save-error-message.ts';
import { useCreateExpense } from '../hooks/useCreateExpense.ts';
import { useNameSuggestions } from '../hooks/useNameSuggestions.ts';
import { useRates } from '../hooks/useRates.ts';
import { createExpenseFormSchema, type ExpenseFormValues } from '../schemas/expense-form.schema.ts';
import { pickSuggestions } from '../utils/pick-suggestions.ts';
import { AmountFields } from './AmountFields.tsx';
import { CardPicker } from './CardPicker.tsx';
import { NameSuggestions } from './NameSuggestions.tsx';

/** The last category is remembered per user: two people may share one device. */
const lastCategoryKey = (username: string) => `expenses.lastCategory.${username}`;
const SUCCESS_VISIBLE_MS = 4000;

interface ExpenseFormProps {
  cards: string[];
  categories: string[];
  currency: string;
  user: AuthUser;
}

/** The user's last choice, if it is still in the reference data. */
function rememberedChoice(key: string, options: string[]): string | undefined {
  const value = readStored(key);
  return value && options.includes(value) ? value : undefined;
}

/** What goes to the server: whole amount in drams; for a foreign currency, the amount, currency and the rate the user saw. */
function amountPayload(values: ExpenseFormValues, base: string) {
  if (values.currency === base) {
    return { amount: parseAmount(values.amount)! };
  }
  return {
    amount: parseDecimal(values.amount)!,
    currency: values.currency,
    rate: parseDecimal(values.rate)!,
  };
}

function successMessage({ amount, original }: CreatedExpense, base: string): string {
  if (!original) return 'Расход успешно добавлен';
  return `Расход добавлен: ${formatMoney(amount)} ${base} (${formatMoney(original.amount)} ${original.currency} по курсу ${formatMoney(original.rate, 6)})`;
}

export function ExpenseForm({ cards, categories, currency, user }: ExpenseFormProps) {
  const createExpense = useCreateExpense();
  // One key per attempt: resubmitting the same operation will not create a duplicate
  const idempotencyKey = useRef(newRequestId());

  const schema = useMemo(() => createExpenseFormSchema(currency), [currency]);

  const form = useForm<ExpenseFormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      date: todayIso(),
      // The default card is the signed-in user's card (the card is named after the user)
      card: cards.includes(user.card) ? user.card : (cards[0] ?? ''),
      category: rememberedChoice(lastCategoryKey(user.username), categories) ?? '',
      name: '',
      currency,
      amount: '',
      rate: '',
    },
  });
  const {
    register,
    handleSubmit,
    reset,
    setFocus,
    getValues,
    setValue,
    control,
    formState: { errors },
  } = form;

  const { data: rates } = useRates();

  const { data: knownNames = [] } = useNameSuggestions();
  const [category, name] = useWatch({ control, name: ['category', 'name'] });
  const suggestions = pickSuggestions(knownNames, { category, query: name });

  const pickSuggestion = ({ name: picked }: NameSuggestion) => {
    setValue('name', picked, { shouldValidate: true, shouldDirty: true });
    setFocus('amount');
  };

  // The success message disappears on its own
  useEffect(() => {
    if (!createExpense.isSuccess) return;
    const timer = setTimeout(createExpense.reset, SUCCESS_VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [createExpense.isSuccess, createExpense.reset]);

  const submit = handleSubmit((values) => {
    if (createExpense.isPending) return;

    const expense = {
      date: values.date,
      card: values.card,
      category: values.category,
      name: values.name.trim(),
      ...amountPayload(values, currency),
    };

    createExpense.mutate(
      { expense, idempotencyKey: idempotencyKey.current },
      {
        onSuccess: () => {
          writeStored(lastCategoryKey(user.username), values.category);
          idempotencyKey.current = newRequestId();

          // Date, card and category are kept for quick entry of the next expense
          reset({ ...getValues(), name: '', amount: '' });
          setFocus('name');
        },
      },
    );
  });

  return (
    <form onSubmit={submit} noValidate className="space-y-5">
      <Field label="Дата" htmlFor="date" error={errors.date?.message}>
        <input
          id="date"
          type="date"
          className={inputClassName}
          aria-invalid={!!errors.date}
          {...register('date')}
        />
      </Field>

      <Field label="Карта" error={errors.card?.message}>
        <CardPicker cards={cards} registration={register('card')} />
      </Field>

      <Field label="Категория" htmlFor="category" error={errors.category?.message}>
        <select
          id="category"
          className={inputClassName}
          aria-invalid={!!errors.category}
          {...register('category')}
        >
          <option value="" disabled>
            Не выбрана
          </option>
          {categories.map((category) => (
            <option key={category} value={category}>
              {category}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Наименование" htmlFor="name" error={errors.name?.message}>
        <input
          id="name"
          type="text"
          autoComplete="off"
          maxLength={255}
          className={inputClassName}
          aria-invalid={!!errors.name}
          {...register('name')}
        />
        <NameSuggestions suggestions={suggestions} onPick={pickSuggestion} />
      </Field>

      <AmountFields form={form} base={currency} rates={rates} />

      {createExpense.isSuccess &&
        (createExpense.data.excelStatus !== 'queued' ? (
          <Notice variant="success">{successMessage(createExpense.data, currency)}</Notice>
        ) : (
          <Notice variant="info">
            Расход сохранён. В Excel он появится позже, когда файл освободится
          </Notice>
        ))}
      {createExpense.isError && (
        <Notice variant="error">{toSaveErrorMessage(createExpense.error)}</Notice>
      )}

      <Button type="submit" loading={createExpense.isPending}>
        {createExpense.isPending ? 'Сохраняем…' : 'Добавить расход'}
      </Button>
    </form>
  );
}

import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useRef } from 'react';
import { useForm } from 'react-hook-form';
import { Button } from '../../../shared/ui/Button.tsx';
import { Field, inputClassName } from '../../../shared/ui/Field.tsx';
import { Notice } from '../../../shared/ui/Notice.tsx';
import { todayIso } from '../../../shared/utils/date.ts';
import { formatAmountInput, parseAmount } from '../../../shared/utils/money.ts';
import { newRequestId } from '../../../shared/utils/request-id.ts';
import { readStored, writeStored } from '../../../shared/utils/storage.ts';
import { toSaveErrorMessage } from '../api/save-error-message.ts';
import { useCreateExpense } from '../hooks/useCreateExpense.ts';
import { expenseFormSchema, type ExpenseFormValues } from '../schemas/expense-form.schema.ts';
import { CardPicker } from './CardPicker.tsx';

const LAST_CARD_KEY = 'expenses.lastCard';
const LAST_CATEGORY_KEY = 'expenses.lastCategory';
const SUCCESS_VISIBLE_MS = 4000;

interface ExpenseFormProps {
  cards: string[];
  categories: string[];
  currency: string;
}

/** Последний выбор пользователя, если он всё ещё есть в справочнике. */
function rememberedChoice(key: string, options: string[]): string | undefined {
  const value = readStored(key);
  return value && options.includes(value) ? value : undefined;
}

export function ExpenseForm({ cards, categories, currency }: ExpenseFormProps) {
  const createExpense = useCreateExpense();
  // Один ключ на попытку: повторная отправка той же операции не создаст дубль
  const idempotencyKey = useRef(newRequestId());

  const {
    register,
    handleSubmit,
    reset,
    setFocus,
    getValues,
    formState: { errors },
  } = useForm<ExpenseFormValues>({
    resolver: zodResolver(expenseFormSchema),
    defaultValues: {
      date: todayIso(),
      card: rememberedChoice(LAST_CARD_KEY, cards) ?? cards[0] ?? '',
      category: rememberedChoice(LAST_CATEGORY_KEY, categories) ?? '',
      name: '',
      amount: '',
    },
  });

  // Сообщение об успехе исчезает само
  useEffect(() => {
    if (!createExpense.isSuccess) return;
    const timer = setTimeout(createExpense.reset, SUCCESS_VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [createExpense.isSuccess, createExpense.reset]);

  const amountField = register('amount');

  const submit = handleSubmit((values) => {
    if (createExpense.isPending) return;

    const expense = {
      date: values.date,
      card: values.card,
      category: values.category,
      name: values.name.trim(),
      amount: parseAmount(values.amount)!,
    };

    createExpense.mutate(
      { expense, idempotencyKey: idempotencyKey.current },
      {
        onSuccess: () => {
          writeStored(LAST_CARD_KEY, values.card);
          writeStored(LAST_CATEGORY_KEY, values.category);
          idempotencyKey.current = newRequestId();

          // Дата, карта и категория остаются для быстрого ввода следующего расхода
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
      </Field>

      <Field label="Стоимость" htmlFor="amount" error={errors.amount?.message}>
        <div className="relative">
          <input
            id="amount"
            type="text"
            inputMode="numeric"
            autoComplete="off"
            className={`${inputClassName} pr-16`}
            aria-invalid={!!errors.amount}
            {...amountField}
            onChange={(event) => {
              event.target.value = formatAmountInput(event.target.value);
              return amountField.onChange(event);
            }}
          />
          <span className="pointer-events-none absolute inset-y-0 right-4 flex items-center text-sm text-zinc-500">
            {currency}
          </span>
        </div>
      </Field>

      {createExpense.isSuccess &&
        (createExpense.data.excelStatus === 'synced' ? (
          <Notice variant="success">Расход успешно добавлен</Notice>
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

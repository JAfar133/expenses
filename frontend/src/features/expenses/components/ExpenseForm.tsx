import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import type { AuthUser } from '../../auth/api/auth.api.ts';
import { Button } from '../../../shared/ui/Button.tsx';
import { Field, inputClassName } from '../../../shared/ui/Field.tsx';
import { SelectBox, selectPadding } from '../../../shared/ui/SelectBox.tsx';
import { Toast } from '../../../shared/ui/Toast.tsx';
import { Notice } from '../../../shared/ui/Notice.tsx';
import { todayIso } from '../../../shared/utils/date.ts';
import { crossRate, currencyDigits } from '../../../shared/utils/conversion.ts';
import {
  formatAmountInput,
  formatAmount,
  formatDecimalInput,
  formatMoney,
  parseAmount,
  parseDecimal,
} from '../../../shared/utils/money.ts';
import { newRequestId } from '../../../shared/utils/request-id.ts';
import { readStored, writeStored } from '../../../shared/utils/storage.ts';
import type { Card, CreatedExpense, NameSuggestion, RatesResponse } from '../api/expenses.api.ts';
import { QUEUED_MESSAGE, useSubmitExpense } from '../hooks/useSubmitExpense.ts';
import type { QueuedExpense } from '../../offline-queue/model/queue-types.ts';
import { draftToFormValues } from '../../offline-queue/model/draft.ts';
import { useNameSuggestions } from '../hooks/useNameSuggestions.ts';
import { useRates } from '../hooks/useRates.ts';
import { createExpenseFormSchema, type ExpenseFormValues } from '../schemas/expense-form.schema.ts';
import { pickSuggestions } from '../utils/pick-suggestions.ts';
import { AmountFields, rateText } from './AmountFields.tsx';
import { CardSelect } from './CardSelect.tsx';
import { CategoryLimitHint } from '../../budgets/components/CategoryLimitHint.tsx';
import { ReceiptPicker } from '../../receipts/components/ReceiptPicker.tsx';
import { useReceiptAllowed } from '../../receipts/hooks/useReceiptSettings.ts';
import { clearPendingPhoto, usePendingPhoto } from '../../receipts/model/pending-photo.ts';
import { useAiPhotoFirst } from '../../ai/hooks/useAiPhotoFirst.ts';
import { useAiInCategory } from '../../ai/hooks/useAiInCategory.ts';
import { AiSuggestion } from '../../ai/components/AiSuggestion.tsx';
import { AiMark } from '../../ai/components/AiMark.tsx';
import { AiNotice } from '../../ai/components/AiNotice.tsx';
import { ReceiptTotalHint } from '../../ai/components/ReceiptTotalHint.tsx';
import { PhotoParseStatus } from '../../ai/components/PhotoParseStatus.tsx';
import { useFormDraft } from '../hooks/useFormDraft.ts';
import { useReceiptPreparse } from '../hooks/useReceiptPreparse.ts';
import { ReceiptItemsField } from '../../items/components/ReceiptItemsField.tsx';
import { draftsToInputs, inputsToDrafts, type DraftItem } from '../../items/model/draft-items.ts';
import { NameSuggestions } from './NameSuggestions.tsx';
import type { Template } from '../../templates/api/templates.api.ts';

/** The last category is remembered per user: two people may share one device. */
const lastCategoryKey = (username: string) => `expenses.lastCategory.${username}`;
const SUCCESS_VISIBLE_MS = 4000;

interface ExpenseFormProps {
  cards: Card[];
  categories: string[];
  /** Reporting currency of the group */
  currency: string;
  /** Drams: rates are quoted against it */
  baseCurrency: string;
  user: AuthUser;
  /** An expense taken back from the offline queue to be corrected: its values go into the form */
  draft?: QueuedExpense;
  onDraftApplied?: () => void;
  /** A template to put into the form (a tap on a template without an amount, or «В форму») */
  template?: Template;
  onTemplateApplied?: () => void;
  /** After a save: offer to keep the expense as a template (not offered when one like it exists) */
  templateOffer?: {
    exists: (category: string, name: string) => boolean;
    onSave: (created: CreatedExpense) => void;
  };
}

/** The user's last choice, if it is still in the reference data. */
function rememberedChoice(key: string, options: string[]): string | undefined {
  const value = readStored(key);
  return value && options.includes(value) ? value : undefined;
}

/**
 * What goes to the server: the amount in the typed currency. The currency is sent only when it differs from the card's
 * one, the rate only when it is neither drams nor the card currency (the server knows the rest).
 */
function amountPayload(values: ExpenseFormValues, base: string, cardCurrency: string) {
  const isBase = values.currency === base;
  const amount = parseDecimal(values.amount)!;
  if (values.currency === cardCurrency) return { amount };
  if (isBase) return { amount, currency: values.currency };
  return { amount, currency: values.currency, rate: parseDecimal(values.rate)! };
}

/** The message names the amount in the reporting currency of the group, as the record reports it. */
function successMessage(
  { reportingAmount, reportingCurrency, original }: CreatedExpense,
  reporting: string,
  base: string,
): string {
  if (!original) return 'Расход успешно добавлен';
  return `Расход добавлен: ${formatAmount(reportingAmount, currencyDigits(reportingCurrency ?? reporting, base))} ${reportingCurrency ?? reporting} (${formatMoney(original.amount)} ${original.currency} по курсу ${formatMoney(original.rate, 6)})`;
}

/** The typed amount in the reporting currency of the group; null if it is empty or the rate is unknown. */
function amountInReporting(
  amount: string,
  inputCurrency: string,
  reporting: string,
  base: string,
  rates: RatesResponse | undefined,
): number | null {
  const value = parseDecimal(amount);
  if (value === null) return null;
  const rate = crossRate(rates?.rates, inputCurrency, reporting, base);
  return rate === undefined ? null : value * rate;
}

/** A field label with the spark while the AI value is still as the AI wrote it. */
function LabelWithMark({ text, ai }: { text: string; ai: boolean }) {
  return (
    <>
      {text} {ai && <AiMark />}
    </>
  );
}

export function ExpenseForm({
  cards,
  categories,
  currency,
  baseCurrency,
  user,
  draft,
  onDraftApplied,
  template,
  onTemplateApplied,
  templateOffer,
}: ExpenseFormProps) {
  const { state, submit: submitExpense, reset: resetState } = useSubmitExpense();
  // The date counts as typed by a person only when they changed it: the AI may replace the default
  const dateTouched = useRef(false);
  const nameOptional = useRef(false);
  const [items, setItems] = useState<DraftItem[]>([]);
  const [itemsError, setItemsError] = useState<string>();
  // One key per attempt: resubmitting the same operation will not create a duplicate
  const idempotencyKey = useRef(newRequestId());

  const cardNames = useMemo(() => cards.map((card) => card.name), [cards]);
  const cardCurrencyOf = (name: string) =>
    cards.find((card) => card.name === name)?.currency ?? baseCurrency;
  const schema = useMemo(
    () =>
      createExpenseFormSchema(
        baseCurrency,
        Object.fromEntries(cards.map((card) => [card.name, card.currency])),
        () => nameOptional.current,
      ),
    [baseCurrency, cards],
  );
  const defaultCard = cardNames.includes(user.card) ? user.card : (cardNames[0] ?? '');

  const form = useForm<ExpenseFormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      date: todayIso(),
      // The default card is the signed-in user's card (the card is named after the user)
      card: defaultCard,
      category: rememberedChoice(lastCategoryKey(user.username), categories) ?? '',
      name: '',
      // The typed currency starts as the currency of the card
      currency: cardCurrencyOf(defaultCard),
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

  // An optional photo of the receipt, only for the categories the owner chose
  const [photo, setPhoto] = useState<Blob | null>(null);

  const { data: knownNames = [] } = useNameSuggestions();
  const [category, name, typedAmount, typedCurrency, typedDate] = useWatch({
    control,
    name: ['category', 'name', 'amount', 'currency', 'date'],
  });
  const projected = amountInReporting(typedAmount, typedCurrency, currency, baseCurrency, rates);
  const receiptAllowed = useReceiptAllowed(category);
  // The AI reads the receipt only where the owner allowed it
  const aiHere = useAiInCategory(category);
  // Before a category is chosen a receipt can still be loaded when the AI is on: it will name the category itself
  const photoFirst = useAiPhotoFirst() && !category;
  const showPhoto = receiptAllowed || photoFirst;
  const aiEligible = category ? aiHere : photoFirst;
  // A receipt photo for the AI: the name may be left empty
  nameOptional.current = aiEligible && photo !== null;
  const attachedPhoto = showPhoto ? photo : null;
  const [photoWarning, setPhotoWarning] = useState<string>();
  // A photo from the camera button (taken on another page or on this one) replaces the current one
  const pendingPhoto = usePendingPhoto();
  useEffect(() => {
    if (!pendingPhoto) return;
    setPhoto(pendingPhoto);
    setPhotoWarning(undefined);
    clearPendingPhoto();
  }, [pendingPhoto]);
  const ai = useReceiptPreparse({
    form,
    photo: attachedPhoto,
    eligible: aiEligible,
    category,
    categories,
    items,
    setItems,
    dateTouched,
    currencies: {
      available: () => [
        ...new Set([cardCurrencyOf(form.getValues('card')), ...(rates?.currencies ?? [])]),
      ],
      switchTo: (code) => {
        const card = cardCurrencyOf(form.getValues('card'));
        // As a manual choice in the field: the rate follows
        form.setValue('currency', code);
        form.setValue('rate', code !== baseCurrency && code !== card ? rateText(rates, code) : '', {
          shouldValidate: false,
        });
      },
    },
  });
  const draftState = useFormDraft({
    username: user.username,
    form,
    items,
    setItems,
    photo,
    setPhoto,
    dateTouched,
    ai,
    blocked: draft !== undefined,
  });
  const parsing = ai.state.status === 'running';

  // A category that does not allow a photo: the photo is taken off (with a word about it)
  useEffect(() => {
    if (category && photo && !receiptAllowed) {
      setPhoto(null);
      setPhotoWarning('В этой категории фото чека не включено, фото убрано');
    }
  }, [category, photo, receiptAllowed]);
  // Pressing «Добавить» while the AI is still reading waits for it, then saves with what it filled in
  const [waitingForParse, setWaitingForParse] = useState(false);
  const suggestions = pickSuggestions(knownNames, { category, query: name });

  const pickSuggestion = ({ name: picked }: NameSuggestion) => {
    setValue('name', picked, { shouldValidate: true, shouldDirty: true });
    setFocus('amount');
  };

  // The success message disappears on its own
  useEffect(() => {
    if (state.status !== 'sent' && state.status !== 'queued') return;
    const timer = setTimeout(resetState, SUCCESS_VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [state, resetState]);

  // An expense taken back from the queue: its values go into the form to be corrected and sent again
  useEffect(() => {
    if (!draft) return;
    reset(draftToFormValues(draft, baseCurrency, cardCurrencyOf(draft.expense.card)));
    setPhoto(draft.photo ?? null);
    setItems(inputsToDrafts(draft.expense.items));
    dateTouched.current = draft.expense.dateSource === 'manual';
    resetState();
    onDraftApplied?.();
    // Only a new draft matters
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);

  // A template: its card, category, name and, if it has one, the amount go into the form
  useEffect(() => {
    if (!template) return;
    const card = cardNames.includes(template.effectiveCard)
      ? template.effectiveCard
      : getValues('card');
    const cardCurrency = cardCurrencyOf(card);
    // A template replaces what it defines; without an amount it keeps the amount (and currency) the user typed
    const keepTyped = template.amount === null && getValues('amount').trim() !== '';
    const typed = keepTyped
      ? getValues('currency')
      : template.amount !== null
        ? (template.currency ?? cardCurrency)
        : cardCurrency;
    setValue('card', card);
    setValue('category', categories.includes(template.category) ? template.category : '', {
      shouldValidate: true,
    });
    setValue('name', template.expenseName, { shouldValidate: true, shouldDirty: true });
    setValue('currency', typed);
    setValue(
      'rate',
      typed !== baseCurrency && typed !== cardCurrency ? rateText(rates, typed) : '',
    );
    if (template.amount !== null) {
      setValue(
        'amount',
        formatDecimalInput(String(template.amount), { maxDecimals: 2, group: true }),
        { shouldValidate: true },
      );
    }
    resetState();
    if (template.amount === null && !keepTyped) setFocus('amount');
    onTemplateApplied?.();
    // Only a new template matters
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [template]);

  // A new card: the typed currency goes back to the card's one, the rate is not needed
  const resetCurrencyFor = (cardName: string) => {
    const next = cardCurrencyOf(cardName);
    setValue('currency', next);
    setValue('rate', '');
  };

  const submit = handleSubmit(async (values) => {
    const attached = attachedPhoto;
    const parsed = draftsToInputs(items);
    if ('error' in parsed) return setItemsError(parsed.error);
    setItemsError(undefined);

    // With a photo and the AI on, the sources tell the AI what it may replace
    const forAi = aiEligible && attached !== null;
    // The parse id goes only where the AI may read receipts of the chosen category
    const parseId = aiHere ? ai.parseId : undefined;
    const typedName = values.name.trim();
    const expense = {
      date: values.date,
      card: values.card,
      category: values.category,
      name: typedName || (forAi ? 'Чек' : ''),
      ...amountPayload(values, baseCurrency, cardCurrencyOf(values.card)),
      ...(parsed.items.length > 0 ? { items: parsed.items } : {}),
      ...(parseId ? { aiParseId: parseId } : {}),
      // Without a parse before saving, the sources tell the AI what it may replace later
      ...(forAi && !parseId
        ? {
            nameSource: typedName ? ('manual' as const) : ('default' as const),
            dateSource: dateTouched.current ? ('manual' as const) : ('default' as const),
          }
        : {}),
    };

    // After saving the AI parses only what could not be parsed before: nothing leaves without the notice confirmed
    const parseLater = forAi && ai.noticeSeen && !parseId;
    const result = await submitExpense(
      expense,
      idempotencyKey.current,
      attached,
      parseLater,
      parseLater && ai.state.status === 'idle',
    );
    if (result !== 'sent' && result !== 'queued') return;

    setPhoto(null);
    setItems([]);
    ai.clearMarks();
    draftState.markSaved();
    writeStored(lastCategoryKey(user.username), values.category);
    // The next expense is a new operation: a new key (the old one lives on in the queue record)
    idempotencyKey.current = newRequestId();

    // Date, card and category are kept for quick entry of the next expense
    reset({ ...getValues(), name: '', amount: '' });
    setFocus('name');
  });

  // The reading is over: the waiting submit goes on with the form filled in
  useEffect(() => {
    if (!waitingForParse || parsing) return;
    setWaitingForParse(false);
    void submit();
    // `submit` is rebuilt on every render and reads the fresh form
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waitingForParse, parsing]);

  const onSubmit = (event: FormEvent) => {
    if (!parsing) return void submit(event);
    event.preventDefault();
    setWaitingForParse(true);
  };

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-5">
      {draftState.restored && (
        <Toast onDismiss={draftState.dismissNotice}>
          <span className="flex-1">Восстановлен несохранённый черновик</span>
          <button
            type="button"
            onClick={draftState.discard}
            className="shrink-0 rounded-lg px-2 py-1 font-semibold text-indigo-600 hover:bg-indigo-50 dark:text-indigo-300 dark:hover:bg-indigo-950/60"
          >
            Очистить
          </button>
        </Toast>
      )}
      <Field
        label={<LabelWithMark text="Дата" ai={ai.aiDate !== null && typedDate === ai.aiDate} />}
        htmlFor="date"
        error={errors.date?.message}
      >
        <input
          id="date"
          type="date"
          className={`${inputClassName} ${parsing ? 'animate-pulse' : ''}`}
          aria-invalid={!!errors.date}
          {...register('date', {
            onChange: () => {
              dateTouched.current = true;
            },
          })}
        />
      </Field>

      <Field label="Карта" htmlFor="card" error={errors.card?.message}>
        <CardSelect
          cards={cards}
          invalid={!!errors.card}
          registration={register('card', {
            onChange: (event) => resetCurrencyFor(event.target.value),
          })}
        />
      </Field>

      {/* Category and name are close: the suggestions under the name belong to the chosen category */}
      <div className="space-y-3">
        <Field
          label={
            <LabelWithMark
              text="Категория"
              ai={ai.aiCategory !== null && category === ai.aiCategory}
            />
          }
          htmlFor="category"
          error={errors.category?.message}
        >
          <SelectBox>
            <select
              id="category"
              className={`${inputClassName} ${selectPadding}`}
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
          </SelectBox>
        </Field>
        {ai.suggestedCategory && (
          <AiSuggestion
            lead="ИИ считает"
            value={ai.suggestedCategory}
            onChoose={ai.chooseSuggested}
          />
        )}

        {showPhoto && (
          <ReceiptPicker
            photo={photo}
            onChange={(next) => {
              setPhoto(next);
              setPhotoWarning(undefined);
            }}
            status={
              aiEligible && photo && !ai.needsNotice ? (
                <PhotoParseStatus
                  state={ai.state}
                  onRetry={ai.retry}
                  categoryHint={ai.askForCategory}
                  fallbackCurrency={typedCurrency}
                />
              ) : undefined
            }
          />
        )}
        {photoFirst && (
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            ИИ сам заполнит данные, включая категорию
          </p>
        )}
        {photoWarning && <Notice variant="info">{photoWarning}</Notice>}
        {aiEligible && photo && ai.needsNotice && <AiNotice onConfirm={ai.confirmNotice} />}

        <Field
          label={
            <LabelWithMark text="Наименование" ai={ai.aiName !== null && name === ai.aiName} />
          }
          htmlFor="name"
          error={errors.name?.message}
        >
          <input
            id="name"
            type="text"
            autoComplete="off"
            maxLength={255}
            placeholder={nameOptional.current ? 'Можно оставить пустым: заполнит ИИ' : undefined}
            className={`${inputClassName} ${parsing ? 'animate-pulse' : ''}`}
            aria-invalid={!!errors.name}
            {...register('name')}
          />
          <NameSuggestions suggestions={suggestions} onPick={pickSuggestion} />
          {ai.suggestedName && (
            <AiSuggestion
              lead="ИИ предлагает"
              value={ai.suggestedName}
              onChoose={ai.chooseSuggestedName}
            />
          )}
        </Field>
      </div>

      <AmountFields
        form={form}
        base={baseCurrency}
        cards={cards}
        rates={rates}
        aiAmount={ai.aiAmount !== null && typedAmount === ai.aiAmount}
      />
      {ai.receiptTotal && (
        <ReceiptTotalHint
          total={ai.receiptTotal.total}
          currency={ai.receiptTotal.currency}
          onApply={ai.applyTotal}
        />
      )}
      {category && <CategoryLimitHint category={category} projected={projected} />}
      <div aria-busy={parsing} className={parsing ? 'animate-pulse' : undefined}>
        <ReceiptItemsField
          value={items}
          onChange={setItems}
          error={itemsError}
          amount={parseDecimal(typedAmount)}
          currency={typedCurrency}
          baseCurrency={baseCurrency}
        />
      </div>

      {state.status === 'sent' &&
        (state.created.excelStatus !== 'queued' ? (
          <Notice variant="success">{successMessage(state.created, currency, baseCurrency)}</Notice>
        ) : (
          <Notice variant="info">
            Расход сохранён. В Excel он появится позже, когда файл освободится
          </Notice>
        ))}
      {state.status === 'sent' &&
        templateOffer &&
        !templateOffer.exists(state.created.category, state.created.name) && (
          <button
            type="button"
            onClick={() => templateOffer.onSave(state.created)}
            className="-mt-2 h-10 rounded-lg px-1 text-sm font-semibold text-indigo-600 dark:text-indigo-300"
          >
            Сохранить как шаблон
          </button>
        )}
      {state.status === 'queued' && <Notice variant="info">{QUEUED_MESSAGE}</Notice>}
      {state.status === 'sent' && state.photoFailed && (
        <Notice variant="info">
          Расход сохранён, но фото не загрузилось. Его можно прикрепить позже в «Операциях».
        </Notice>
      )}
      {state.status === 'error' && <Notice variant="error">{state.message}</Notice>}

      <Button type="submit" loading={state.status === 'pending' || waitingForParse}>
        {waitingForParse
          ? 'Ждём разбор чека…'
          : state.status === 'pending'
            ? 'Сохраняем…'
            : 'Добавить расход'}
      </Button>
    </form>
  );
}

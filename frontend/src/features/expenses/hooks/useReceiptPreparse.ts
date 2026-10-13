import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react';
import type { UseFormReturn } from 'react-hook-form';
import { formatAmount, parseDecimal } from '../../../shared/utils/money.ts';
import type { PhotoParse } from '../../ai/api/ai.api.ts';
import { useAiNotice } from '../../ai/hooks/useAiNotice.ts';
import { usePhotoParse } from '../../ai/hooks/usePhotoParse.ts';
import { isAiGenerated, parsedToDrafts, type DraftItem } from '../../items/model/draft-items.ts';
import { sumItems } from '../../items/model/items-sum.ts';
import type { ExpenseFormValues } from '../schemas/expense-form.schema.ts';

interface Options {
  form: UseFormReturn<ExpenseFormValues>;
  /** The photo that will be saved with the expense (null when none or not allowed) */
  photo: Blob | null;
  /** The AI is on and may read receipts of the chosen category */
  eligible: boolean;
  /** The category chosen in the form: the server checks that the AI is allowed there */
  /** Empty until the person (or the AI) chooses one: the receipt is then parsed without a category */
  category: string;
  /** The categories of the group: the one the AI names must be among them */
  categories: string[];
  items: DraftItem[];
  setItems: Dispatch<SetStateAction<DraftItem[]>>;
  /** The person changed the date by hand: the AI must not replace it */
  dateTouched: MutableRefObject<boolean>;
}

/** The amount for the field: a fractional one always with two decimals («1 500,50»), a whole one without. */
const amountText = (value: number) => formatAmount(value, 0);

/** The sum of the positions rounded to cents; 0 when there are none. */
const positionsSum = (items: { price: number }[]) => sumItems(items);

/**
 * Reads the receipt with the AI as soon as the photo is chosen (after the one-time notice is confirmed) and fills the
 * form: the name, the date and the positions, but only where the person has not typed their own. What the AI filled
 * stays marked until the person changes it. The amount is never taken from the receipt.
 */
export function useReceiptPreparse({
  form,
  photo,
  eligible,
  category,
  categories,
  items,
  setItems,
  dateTouched,
}: Options) {
  const notice = useAiNotice();
  const [aiName, setAiName] = useState<string | null>(null);
  const [aiDate, setAiDate] = useState<string | null>(null);
  // The amount text the AI put into the field: the mark stays while it is unchanged
  const [aiAmount, setAiAmount] = useState<string | null>(null);
  const [aiCategory, setAiCategory] = useState<string | null>(null);
  // Fresh values for the answer handler, which may come long after the render that started the parse
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const marks = useRef({ name: aiName, date: aiDate, amount: aiAmount });
  marks.current = { name: aiName, date: aiDate, amount: aiAmount };

  const apply = (result: PhotoParse) => {
    const current = form.getValues();
    // A receipt loaded before any category: the AI names it, unless the person has chosen one meanwhile
    if (!current.category && result.category && categories.includes(result.category)) {
      form.setValue('category', result.category, { shouldValidate: true });
      setAiCategory(result.category);
    }
    if (result.name && (!current.name.trim() || current.name === marks.current.name)) {
      form.setValue('name', result.name, { shouldValidate: true });
      setAiName(result.name);
    }
    if (result.date && (!dateTouched.current || current.date === marks.current.date)) {
      form.setValue('date', result.date);
      setAiDate(result.date);
    }
    // The amount: the receipt total, else the sum of the positions; never over what the person typed, and not in
    // another currency than the one chosen in the field
    const amount = result.total ?? positionsSum(result.items);
    const sameCurrency = !result.currency || result.currency === current.currency;
    if (
      amount &&
      sameCurrency &&
      (!current.amount.trim() || current.amount === marks.current.amount)
    ) {
      const text = amountText(amount);
      form.setValue('amount', text, { shouldValidate: true });
      setAiAmount(text);
    }
    const rows = itemsRef.current;
    if (result.items.length > 0 && (rows.length === 0 || rows.every(isAiGenerated))) {
      setItems(parsedToDrafts(result.items));
    }
  };

  const parse = usePhotoParse(apply);
  const { start, reset } = parse;

  // A receipt read without a category stays valid when the person chooses one afterwards: no second reading
  const keepResult = useRef(false);
  const lastPhoto = useRef<Blob | null>(null);

  useEffect(() => {
    if (photo !== lastPhoto.current) keepResult.current = false;
    lastPhoto.current = photo;
    if (!photo) return reset();
    if (!eligible) {
      if (!keepResult.current) reset();
      return;
    }
    // Nothing leaves the device before the person has seen where the photo goes
    if (notice.ready && notice.seen) {
      void start(photo, category || undefined);
      keepResult.current = !category;
    }
    // A new category alone does not read the receipt again; allowing the AI there does (`eligible`)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photo, eligible, notice.ready, notice.seen, start, reset]);

  const result = parse.state.status === 'done' ? parse.state.result : undefined;
  const typed = parseDecimal(form.watch('amount'));
  const fieldCurrency = form.watch('currency');
  // Only a total that came from the receipt, and only when it differs from the field by a currency unit
  const receiptTotal =
    result?.total != null && (typed === null || Math.abs(typed - result.total) >= 1)
      ? { total: result.total, currency: result.currency ?? fieldCurrency }
      : undefined;
  const sameCurrency = !result?.currency || result.currency === fieldCurrency;

  const applyTotal = () => {
    if (result?.total == null) return;
    const text = amountText(result.total);
    form.setValue('amount', text, { shouldValidate: true });
    setAiAmount(text);
  };

  // The AI's own idea of the category, while it differs from the current one (an empty field is filled by itself)
  const suggested = result?.category ?? null;
  const suggestedCategory =
    suggested && category && suggested !== category && categories.includes(suggested)
      ? suggested
      : null;
  const chooseSuggested = () => {
    if (!suggestedCategory) return;
    form.setValue('category', suggestedCategory, { shouldValidate: true });
    setAiCategory(suggestedCategory);
  };

  // The same for the name typed by the person: the AI's reading is offered, not forced
  const typedName = form.watch('name');
  const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
  const suggestedName =
    result?.name && typedName.trim() && typedName !== aiName && !sameName(result.name, typedName)
      ? result.name
      : null;
  const chooseSuggestedName = () => {
    if (!suggestedName) return;
    form.setValue('name', suggestedName, { shouldValidate: true });
    setAiName(suggestedName);
  };

  return {
    state: parse.state,
    suggestedName,
    chooseSuggestedName,
    suggestedCategory,
    chooseSuggested,
    retry: () => parse.retry(category),
    /** The photo is attached, the AI is on, but the person has not yet seen where it goes */
    needsNotice: eligible && photo !== null && notice.ready && !notice.seen,
    confirmNotice: notice.confirm,
    noticeSeen: notice.seen,
    /** Goes with the expense: the server marks as AI what stayed as read */
    parseId: result?.parseId,
    aiName,
    aiDate,
    aiAmount,
    aiCategory,
    /** The receipt was read without a category and the AI found none: the person chooses */
    askForCategory: result !== undefined && result.category === null && !category,
    receiptTotal,
    /** «Подставить» is offered only when the receipt is in the currency of the field */
    applyTotal: sameCurrency ? applyTotal : undefined,
    /** The values were saved: the marks belong to the previous expense */
    clearMarks: () => {
      setAiName(null);
      setAiDate(null);
      setAiAmount(null);
      setAiCategory(null);
    },
  };
}

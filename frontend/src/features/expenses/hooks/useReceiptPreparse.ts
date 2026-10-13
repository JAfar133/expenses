import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react';
import type { UseFormReturn } from 'react-hook-form';
import { formatDecimalInput, parseDecimal } from '../../../shared/utils/money.ts';
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
  category: string;
  items: DraftItem[];
  setItems: Dispatch<SetStateAction<DraftItem[]>>;
  /** The person changed the date by hand: the AI must not replace it */
  dateTouched: MutableRefObject<boolean>;
}

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
  items,
  setItems,
  dateTouched,
}: Options) {
  const notice = useAiNotice();
  const [aiName, setAiName] = useState<string | null>(null);
  const [aiDate, setAiDate] = useState<string | null>(null);
  // The amount text the AI put into the field: the mark stays while it is unchanged
  const [aiAmount, setAiAmount] = useState<string | null>(null);
  // Fresh values for the answer handler, which may come long after the render that started the parse
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const marks = useRef({ name: aiName, date: aiDate, amount: aiAmount });
  marks.current = { name: aiName, date: aiDate, amount: aiAmount };

  const apply = (result: PhotoParse) => {
    const current = form.getValues();
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
      const text = formatDecimalInput(String(amount).replace('.', ','), {
        maxDecimals: 2,
        group: true,
      });
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

  useEffect(() => {
    if (!photo || !eligible) return reset();
    // Nothing leaves the device before the person has seen where the photo goes
    if (notice.ready && notice.seen) void start(photo, category);
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
    const text = formatDecimalInput(String(result.total).replace('.', ','), {
      maxDecimals: 2,
      group: true,
    });
    form.setValue('amount', text, { shouldValidate: true });
    setAiAmount(text);
  };

  return {
    state: parse.state,
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
    receiptTotal,
    /** «Подставить» is offered only when the receipt is in the currency of the field */
    applyTotal: sameCurrency ? applyTotal : undefined,
    /** The values were saved: the marks belong to the previous expense */
    clearMarks: () => {
      setAiName(null);
      setAiDate(null);
      setAiAmount(null);
    },
  };
}

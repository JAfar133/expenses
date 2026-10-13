import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react';
import type { UseFormReturn } from 'react-hook-form';
import { parseDecimal } from '../../../shared/utils/money.ts';
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
  /** The AI is on and the category allows a photo */
  eligible: boolean;
  items: DraftItem[];
  setItems: Dispatch<SetStateAction<DraftItem[]>>;
  /** The person changed the date by hand: the AI must not replace it */
  dateTouched: MutableRefObject<boolean>;
}

/**
 * Reads the receipt with the AI as soon as the photo is chosen (after the one-time notice is confirmed) and fills the
 * form: the name, the date and the positions, but only where the person has not typed their own. What the AI filled
 * stays marked until the person changes it. The amount is never taken from the receipt.
 */
export function useReceiptPreparse({
  form,
  photo,
  eligible,
  items,
  setItems,
  dateTouched,
}: Options) {
  const notice = useAiNotice();
  const [aiName, setAiName] = useState<string | null>(null);
  const [aiDate, setAiDate] = useState<string | null>(null);
  // Fresh values for the answer handler, which may come long after the render that started the parse
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const marks = useRef({ name: aiName, date: aiDate });
  marks.current = { name: aiName, date: aiDate };

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
    if (notice.ready && notice.seen) void start(photo);
  }, [photo, eligible, notice.ready, notice.seen, start, reset]);

  const result = parse.state.status === 'done' ? parse.state.result : undefined;
  const typed = parseDecimal(form.watch('amount'));
  const itemsTotal = sumItems(items.map((row) => ({ price: parseDecimal(row.price) ?? 0 })));
  const differs = (value: number) => Math.abs(value - result!.total!) >= 1;
  const receiptTotal =
    result?.total != null &&
    (typed === null || differs(typed) || (itemsTotal > 0 && differs(itemsTotal)))
      ? { total: result.total, currency: result.currency }
      : undefined;

  return {
    state: parse.state,
    retry: parse.retry,
    /** The photo is attached, the AI is on, but the person has not yet seen where it goes */
    needsNotice: eligible && photo !== null && notice.ready && !notice.seen,
    confirmNotice: notice.confirm,
    noticeSeen: notice.seen,
    /** Goes with the expense: the server marks as AI what stayed as read */
    parseId: result?.parseId,
    aiName,
    aiDate,
    receiptTotal,
    /** The values were saved: the marks belong to the previous expense */
    clearMarks: () => {
      setAiName(null);
      setAiDate(null);
    },
  };
}

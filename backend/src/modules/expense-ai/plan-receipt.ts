import { addDays } from '../analytics/date-math.ts';
import type { ItemSource } from '../items/items.types.ts';
import type { ParsedItem, ParsedReceipt } from '../llm/receipt-parser.ts';

export type FieldSource = 'default' | 'manual' | 'ai';

/** How far back a receipt date may be before it is taken for a recognition mistake. */
const MAX_AGE_DAYS = 366;

export interface CurrentExpense {
  name: string;
  nameSource: FieldSource;
  date: string;
  dateSource: FieldSource;
  items: { source: ItemSource }[];
}

/** What to write to the expense. A field that is absent stays as it is. */
export interface ReceiptPlan {
  name?: string;
  date?: string;
  /** The new list of items (an empty list is never planned) */
  items?: ParsedItem[];
  /** The receipt has items but the person has their own: they are offered, not written */
  itemsKept: boolean;
}

/** A person's own value is never replaced; the form's default and the AI's earlier value may be. */
const replaceable = (source: FieldSource) => source === 'default' || source === 'ai';

const isRealDate = (iso: string) => {
  const date = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === iso;
};

/** The date from the receipt, if it is believable: a real day, not in the future, not too old. */
export const believableDate = (iso: string | undefined, today: string): string | undefined =>
  iso && isRealDate(iso) && iso <= today && iso >= addDays(today, -MAX_AGE_DAYS) ? iso : undefined;

/**
 * Decides what the parsed receipt may change. The rule: the AI only fills what a person did not enter themselves.
 * The amount, the card and the category are never touched.
 */
export function planReceipt(
  current: CurrentExpense,
  parsed: ParsedReceipt,
  options: { today: string; replaceItems: boolean },
): ReceiptPlan {
  const plan: ReceiptPlan = { itemsKept: false };

  if (parsed.name && replaceable(current.nameSource) && parsed.name !== current.name) {
    plan.name = parsed.name;
  }
  const date = believableDate(parsed.date, options.today);
  if (date && replaceable(current.dateSource) && date !== current.date) plan.date = date;

  if (parsed.items.length > 0) {
    const ownItems = current.items.some((item) => item.source === 'manual');
    if (!ownItems || options.replaceItems) plan.items = parsed.items;
    else plan.itemsKept = true;
  }
  return plan;
}

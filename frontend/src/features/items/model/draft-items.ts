import { formatDecimalInput, parseDecimal } from '../../../shared/utils/money.ts';
import { newRequestId } from '../../../shared/utils/request-id.ts';
import type { ExpenseItem, ItemInput, ItemSource } from '../api/items.api.ts';

export const MAX_ITEMS = 100;
export const MAX_NAME_LENGTH = 200;
const PRICE_DECIMALS = 2;
const QUANTITY_DECIMALS = 3;

/** A row of the editor: everything is text, as typed. */
export interface DraftItem {
  /** Stable key of the row in the list */
  key: string;
  /** The server id of an existing position */
  id?: string;
  name: string;
  price: string;
  /** Empty means 1 */
  quantity: string;
  /** Where the position came from and what it looked like then: the AI mark stays while nothing is changed */
  origin?: { source: ItemSource; name: string; price: string; quantity: string };
}

export const emptyDraft = (): DraftItem => ({
  key: newRequestId(),
  name: '',
  price: '',
  quantity: '',
});

export const formatPrice = (value: string) =>
  formatDecimalInput(value, { maxDecimals: PRICE_DECIMALS, group: true });
export const formatQuantity = (value: string) =>
  formatDecimalInput(value, { maxDecimals: QUANTITY_DECIMALS });

/** Server positions to editor rows (quantity 1 is not shown). */
export function itemsToDrafts(items: ExpenseItem[]): DraftItem[] {
  return items.map((item) => {
    const price = formatPrice(String(item.price).replace('.', ','));
    const quantity = item.quantity === 1 ? '' : formatQuantity(String(item.quantity));
    return {
      key: item.id,
      id: item.id,
      name: item.name,
      price,
      quantity,
      origin: { source: item.source, name: item.name, price, quantity },
    };
  });
}

/** Positions of an expense taken back from the offline queue to editor rows. */
export function inputsToDrafts(items: ItemInput[] = []): DraftItem[] {
  return items.map((item) => ({
    key: newRequestId(),
    ...(item.id ? { id: item.id } : {}),
    name: item.name,
    price: formatPrice(String(item.price).replace('.', ',')),
    quantity:
      item.quantity === undefined || item.quantity === 1
        ? ''
        : formatQuantity(String(item.quantity).replace('.', ',')),
  }));
}

/** The AI mark is shown while a generated position was not changed by a person. */
export const isAiGenerated = ({ origin, name, price, quantity }: DraftItem): boolean =>
  origin?.source === 'ai' &&
  origin.name === name &&
  origin.price === price &&
  origin.quantity === quantity;

const isBlank = (draft: DraftItem) =>
  !draft.name.trim() && !draft.price.trim() && !draft.quantity.trim();

export type ItemsResult = { items: ItemInput[] } | { error: string };

/** Rows to what the server takes. Fully empty rows are skipped; a half-filled row is an error. */
export function draftsToInputs(drafts: DraftItem[]): ItemsResult {
  const filled = drafts.filter((draft) => !isBlank(draft));
  if (filled.length > MAX_ITEMS) return { error: `Не больше ${MAX_ITEMS} позиций` };

  const items: ItemInput[] = [];
  for (const [index, draft] of filled.entries()) {
    const label = `Позиция ${index + 1}`;
    const name = draft.name.trim();
    if (!name) return { error: `${label}: укажите название` };
    if (name.length > MAX_NAME_LENGTH) {
      return { error: `${label}: название не длиннее ${MAX_NAME_LENGTH} символов` };
    }
    const price = parseDecimal(draft.price);
    if (price === null) return { error: `${label}: укажите цену` };
    const quantity = draft.quantity.trim() ? parseDecimal(draft.quantity) : undefined;
    if (quantity === null || quantity === 0) {
      return { error: `${label}: количество должно быть больше нуля` };
    }
    items.push({
      ...(draft.id ? { id: draft.id } : {}),
      name,
      price,
      ...(quantity === undefined ? {} : { quantity }),
    });
  }
  return { items };
}

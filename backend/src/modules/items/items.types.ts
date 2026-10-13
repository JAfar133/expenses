export type ItemSource = 'manual' | 'ai';

/** A position of an expense (a product or a dish of the receipt). */
export interface ExpenseItem {
  id: string;
  position: number;
  name: string;
  /** The cost of the line (quantity already included), in the currency of the card */
  price: number;
  quantity: number;
  source: ItemSource;
}

/** What is stored for an item: the same without the database id and position (the order of the list is the position). */
export type NewItem = Pick<ExpenseItem, 'name' | 'price' | 'quantity' | 'source'>;

import type { PhotoParse } from '../../ai/api/ai.api.ts';
import type { DraftItem } from '../../items/model/draft-items.ts';
import type { ExpenseFormValues } from '../schemas/expense-form.schema.ts';

/** What the AI parse looked like when the draft was saved. */
export type DraftParse =
  { status: 'idle' } | { status: 'running' } | { status: 'done'; result: PhotoParse };

/** The client marks of what the AI filled in: they stay until the person changes the field. */
export interface DraftAiState {
  name: string | null;
  date: string | null;
  amount: string | null;
  category: string | null;
  parse: DraftParse;
}

/** Everything of the «Добавить» form that is worth keeping when the app is minimised or the page reloads. */
export interface FormDraftData {
  values: ExpenseFormValues;
  items: DraftItem[];
  dateTouched: boolean;
  /** The compressed photo of the receipt */
  photo?: Blob;
  ai: DraftAiState;
}

/** Nothing typed, no photo, no positions: not worth saving. */
export const isEmptyDraft = ({ values, items, photo }: FormDraftData): boolean =>
  !values.name.trim() && !values.amount.trim() && items.length === 0 && !photo;

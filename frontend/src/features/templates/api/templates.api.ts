import { apiRequest } from '../../../shared/api/http.ts';

export type TemplateScope = 'personal' | 'group';

/** A quick-action template as the server sends it to this user. */
export interface Template {
  id: string;
  scope: TemplateScope;
  /** A proposal of a member waiting for the owner of the group; the group does not see it yet */
  pending: boolean;
  /** A personal template: the state of its copy in the group, null if it was never shared */
  sharedStatus: 'proposed' | 'active' | null;
  /** The text of the button */
  name: string;
  emoji: string | null;
  category: string;
  /** The card chosen in the template; null: «моя карта» */
  card: string | null;
  /** The card the expense goes to for this user (the template's one if they may add to it, else their own) */
  effectiveCard: string;
  /** Display name of whoever made the template */
  author: string;
  /** Display name of whoever changed it last; null: never changed since creation */
  updatedBy: string | null;
  /** ISO time of the last change; null: never changed */
  updatedAt: string | null;
  /** The name of the expense that is created */
  expenseName: string;
  amount: number | null;
  /** Currency of `amount`; null: the currency of the card */
  currency: string | null;
  /** The user may change or remove it (the owner of the group may also turn a proposal on) */
  editable: boolean;
  /** The user made it: a proposal they may take back */
  mine: boolean;
  /** Hidden by this user (group templates only) */
  hidden: boolean;
  /** Its category is archived: it cannot be used until changed */
  unavailable: boolean;
}

export type TemplateInput = Pick<
  Template,
  'scope' | 'name' | 'emoji' | 'category' | 'card' | 'expenseName' | 'amount' | 'currency'
>;

const json = (body: unknown): RequestInit => ({ body: JSON.stringify(body) });

export const fetchTemplates = async () => (await apiRequest<Template[]>('/templates')).data;

export const createTemplate = (input: TemplateInput) =>
  apiRequest<{ id: string }>('/templates', { method: 'POST', ...json(input) });

export const updateTemplate = (id: string, input: TemplateInput) =>
  apiRequest(`/templates/${id}`, { method: 'PUT', ...json(input) });

export const deleteTemplate = (id: string) => apiRequest(`/templates/${id}`, { method: 'DELETE' });

/** A member proposes a personal template to the group; the owner publishes it at once. */
export const shareTemplate = async (id: string) =>
  (
    await apiRequest<{ status: 'proposed' | 'active' }>(`/templates/${id}/share`, {
      method: 'POST',
    })
  ).data;

/** The owner of the group turns a proposal on. */
export const approveTemplate = (id: string) =>
  apiRequest(`/templates/${id}/approve`, { method: 'POST' });

/** The caller's own arrangement of everything they see (personal and group templates in one list). */
export const reorderTemplates = (ids: string[]) =>
  apiRequest('/templates/order', { method: 'PUT', ...json({ ids }) });

export const setTemplateHidden = (id: string, hidden: boolean) =>
  apiRequest(`/templates/${id}/hidden`, { method: 'PUT', ...json({ hidden }) });

/** The owner sets the default order of the group templates (for people who have not arranged them themselves). */
export const reorderGroupTemplates = (ids: string[]) =>
  apiRequest('/templates/group-order', { method: 'PUT', ...json({ ids }) });

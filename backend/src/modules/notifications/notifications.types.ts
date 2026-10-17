export const NOTIFICATION_TYPES = ['expense_imported', 'import_problem', 'receipt_parsed'] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/** Who should get an event. */
export type Audience =
  /** Everyone who may see the card: the owners and the members with access to it */
  | { type: 'card'; groupId: string; card: string }
  /** The owners of the group (they manage keys and see the import log) */
  | { type: 'owners'; groupId: string }
  /** One person */
  | { type: 'user'; groupId: string; userId: string };

export interface NotificationEvent {
  type: NotificationType;
  title: string;
  body: string;
  /** A path of the app opened by a tap */
  link?: string;
  data?: Record<string, unknown>;
  /** The same key for the same person is stored once */
  dedupeKey?: string;
  audience: Audience;
}

export interface NotificationView {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  link: string | null;
  data: Record<string, unknown> | null;
  createdAt: string;
  read: boolean;
}

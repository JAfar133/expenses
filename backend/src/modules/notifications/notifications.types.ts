export const NOTIFICATION_TYPES = [
  'expense_imported',
  'import_problem',
  'receipt_parsed',
  /** A message the owner of a group or the administrator sent from the app */
  'announcement',
  /** A person joined the group (accepted an invitation) */
  'member_joined',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/** Who should get an event. */
export type Audience =
  /** Everyone who may see the card: the owners and the members with access to it */
  | { type: 'card'; groupId: string; card: string }
  /** Everyone in the group, optionally except one person */
  | { type: 'group'; groupId: string; exceptUserId?: string }
  /** The owners of the group (they manage keys and see the import log) */
  | { type: 'owners'; groupId: string }
  /** One person */
  | { type: 'user'; groupId: string; userId: string }
  /** Chosen people (a message from the owner or the administrator); the group is only for the record */
  | { type: 'users'; groupId: string | null; userIds: string[] };

export interface NotificationEvent {
  type: NotificationType;
  title: string;
  body: string;
  /** A path of the app opened by a tap */
  link?: string;
  data?: Record<string, unknown>;
  /** The same text without amounts and shops (push in private mode); default: the push says only the title */
  privateBody?: string;
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

/** A new feed entry on its way to a person's devices. */
export interface DeliveryItem {
  id: string;
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  /** The text without amounts and shops, for people who hide them on the lock screen */
  privateBody?: string;
  link?: string;
  createdAt: Date;
  /** The person's unread count after this entry (the badge on the icon) */
  unread: number;
}

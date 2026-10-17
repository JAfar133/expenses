import { apiRequest } from '../../../shared/api/http.ts';

export type NotificationType =
  'expense_imported' | 'import_problem' | 'receipt_parsed' | 'announcement';

export interface AppNotification {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  /** An address inside the app to open on a tap */
  link: string | null;
  data: Record<string, unknown> | null;
  createdAt: string;
  read: boolean;
}

export interface NotificationsPage {
  items: AppNotification[];
  /** All unread notifications of the user, not only those of this page */
  unread: number;
}

export const PAGE_SIZE = 30;

/** The feed, newest first; `before` is the `createdAt` of the last item already shown. */
export const fetchNotifications = async (before?: string) =>
  (
    await apiRequest<NotificationsPage>(
      `/notifications?limit=${PAGE_SIZE}${before ? `&before=${encodeURIComponent(before)}` : ''}`,
    )
  ).data;

export const fetchUnreadCount = async () =>
  (await apiRequest<{ unread: number }>('/notifications/unread-count')).data.unread;

/** Without ids everything is marked read. */
export const markNotificationsRead = (ids?: string[]) =>
  apiRequest('/notifications/read', { method: 'POST', body: JSON.stringify(ids ? { ids } : {}) });

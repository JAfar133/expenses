/** User logged in to the app. */
export interface AuthUser {
  id: string;
  username: string;
  displayName: string;
  /** Default card for the expense form */
  card: string;
  /** Whether the user can edit and delete records */
  canEdit: boolean;
  /** User's time zone (IANA): it determines what "today" is */
  timezone: string;
  /** The group the user belongs to; null while the user is in no group (sees nothing) */
  groupId: string | null;
  /** Role in the group: the owner sees every card and edits records */
  role: GroupRole | null;
  /** Application administrator (manages groups) */
  isAdmin: boolean;
}

export type GroupRole = 'owner' | 'member';

export interface TokenPair {
  accessToken: string;
  accessExpiresAt: Date;
  refreshToken: string;
  refreshExpiresAt: Date;
}

export interface ClientContext {
  ip?: string;
  userAgent?: string;
}

export const ACCESS_COOKIE = 'et_access';
export const REFRESH_COOKIE = 'et_refresh';

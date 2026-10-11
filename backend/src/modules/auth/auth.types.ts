/** Пользователь, вошедший в приложение. */
export interface AuthUser {
  id: string;
  username: string;
  displayName: string;
  /** Карта по умолчанию для формы расхода */
  card: string;
  /** Может ли править и удалять записи */
  canEdit: boolean;
  /** Часовой пояс пользователя (IANA): по нему определяется «сегодня» */
  timezone: string;
}

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

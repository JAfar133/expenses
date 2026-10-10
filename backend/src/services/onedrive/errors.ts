export type OneDriveErrorCode =
  | 'FILE_NOT_FOUND'
  | 'AUTH_FAILED'
  | 'ACCESS_DENIED'
  | 'NETWORK'
  | 'TIMEOUT'
  | 'RATE_LIMITED'
  | 'QUOTA_EXCEEDED'
  | 'FILE_LOCKED'
  | 'VERSION_CONFLICT'
  | 'UPLOAD_NOT_VERIFIED'
  | 'UNKNOWN';

export class OneDriveError extends Error {
  constructor(
    readonly code: OneDriveErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'OneDriveError';
  }

  /** Временные ошибки, при которых безопасно повторять только чтение. */
  get isTransient(): boolean {
    return this.code === 'NETWORK' || this.code === 'TIMEOUT' || this.code === 'RATE_LIMITED';
  }
}

/** Сопоставление текста stderr rclone с кодом ошибки. Порядок правил важен. */
const STDERR_RULES: Array<[RegExp, OneDriveErrorCode]> = [
  [/directory not found|object not found|itemNotFound/i, 'FILE_NOT_FOUND'],
  [
    /invalid_grant|AADSTS|unauthenticated|token (expired|has expired)|couldn't fetch token/i,
    'AUTH_FAILED',
  ],
  [/423|resourceLocked|is locked/i, 'FILE_LOCKED'],
  [/accessDenied|403|forbidden/i, 'ACCESS_DENIED'],
  [/429|throttl|too many requests|activityLimitReached/i, 'RATE_LIMITED'],
  [/insufficientStorage|quotaLimitReached|507|no space left/i, 'QUOTA_EXCEEDED'],
  [
    /no such host|dial tcp|connection (refused|reset)|network is unreachable|i\/o timeout/i,
    'NETWORK',
  ],
];

export function classifyStderr(stderr: string): OneDriveErrorCode {
  return STDERR_RULES.find(([pattern]) => pattern.test(stderr))?.[1] ?? 'UNKNOWN';
}

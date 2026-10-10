import {
  conflictError,
  fileLockedError,
  storageUnavailableError,
  writeStatusUnknownError,
} from '../../errors/app-error.ts';
import { OneDriveError, type OneDriveErrorCode } from '../../services/onedrive/errors.ts';

/** Ошибки, при которых rclone однозначно отказал, не изменив файл. */
const REJECTED_CODES: OneDriveErrorCode[] = [
  'FILE_NOT_FOUND',
  'AUTH_FAILED',
  'ACCESS_DENIED',
  'QUOTA_EXCEEDED',
];

/** Ошибка до начала записи: файл не менялся, повторить можно. */
export function mapReadError(error: unknown): unknown {
  if (!(error instanceof OneDriveError)) {
    return error;
  }
  switch (error.code) {
    case 'VERSION_CONFLICT':
      return conflictError(error);
    case 'FILE_LOCKED':
      return fileLockedError(error);
    default:
      return storageUnavailableError(error);
  }
}

/**
 * Ошибка загрузки. Если нельзя утверждать, что файл не изменился,
 * возвращаем WRITE_STATUS_UNKNOWN, чтобы не спровоцировать дубль.
 */
export function mapWriteError(error: unknown): unknown {
  if (!(error instanceof OneDriveError)) {
    return error;
  }
  if (error.code === 'VERSION_CONFLICT') {
    return conflictError(error);
  }
  if (error.code === 'FILE_LOCKED') {
    return fileLockedError(error);
  }
  if (REJECTED_CODES.includes(error.code)) {
    return storageUnavailableError(error);
  }
  return writeStatusUnknownError(error);
}

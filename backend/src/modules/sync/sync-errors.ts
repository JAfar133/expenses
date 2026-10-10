import { OneDriveError } from '../../services/onedrive/errors.ts';
import type { SyncStatus } from './sync.types.ts';

interface SyncErrorInfo {
  status: SyncStatus;
  code: string;
  message: string;
}

/** Превращает любую ошибку цикла в статус и понятное пользователю сообщение. */
export function describeSyncError(error: unknown): SyncErrorInfo {
  if (!(error instanceof OneDriveError)) {
    const code = (error as { code?: string }).code;
    if (code === 'BACKUP_FAILED') {
      return {
        status: 'error',
        code,
        message: 'Не удалось сделать резервную копию Excel. Записи ждут в очереди',
      };
    }
    return {
      status: 'error',
      code: typeof code === 'string' ? code : 'SYNC_FAILED',
      message: 'Не удалось выполнить синхронизацию. Подробности в логе сервера',
    };
  }

  switch (error.code) {
    case 'FILE_LOCKED':
      return {
        status: 'locked',
        code: error.code,
        message: 'Файл открыт в Excel. Записи ждут в очереди и будут добавлены автоматически',
      };
    case 'VERSION_CONFLICT':
      return {
        status: 'unavailable',
        code: error.code,
        message: 'Файл изменился во время записи. Повторим автоматически',
      };
    case 'AUTH_FAILED':
    case 'ACCESS_DENIED':
      return {
        status: 'unavailable',
        code: error.code,
        message: 'Нет доступа к OneDrive. Проверьте авторизацию rclone',
      };
    case 'FILE_NOT_FOUND':
      return {
        status: 'unavailable',
        code: error.code,
        message: 'Файл Excel не найден в OneDrive',
      };
    case 'UNKNOWN':
      return { status: 'error', code: error.code, message: 'Ошибка при работе с OneDrive' };
    default:
      return {
        status: 'unavailable',
        code: error.code,
        message: 'OneDrive недоступен. Повторим позже',
      };
  }
}

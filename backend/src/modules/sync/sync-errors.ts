import { OneDriveError } from '../../services/onedrive/errors.ts';
import type { SyncStatus } from './sync.types.ts';

interface SyncErrorInfo {
  status: SyncStatus;
  code: string;
  message: string;
}

/** Turns any cycle error into a status and a user-friendly message. */
export function describeSyncError(error: unknown): SyncErrorInfo {
  if (!(error instanceof OneDriveError)) {
    const code = (error as { code?: string }).code;
    if (code === 'ROW_NOT_FOUND') {
      return {
        status: 'error',
        code,
        message:
          'Не нашла в Excel строку, которую нужно исправить или убрать (её изменили вручную). Изменения ждут в очереди',
      };
    }
    if (code === 'VERIFICATION_FAILED') {
      return {
        status: 'error',
        code,
        message:
          'Результат записи в Excel не прошёл проверку, файл не изменён. Подробности в логе сервера',
      };
    }
    if (code === 'TABLE_UNSUPPORTED') {
      return {
        status: 'error',
        code,
        message:
          'Таблица в Excel изменена (столбцы, заголовки или строка итогов). Синхронизация остановлена, база не тронута: верните прежнюю структуру',
      };
    }
    if (code === 'TABLE_BLOCKED') {
      return {
        status: 'error',
        code,
        message:
          'Под таблицей в Excel есть данные: добавить строку некуда, не затерев их. Записи ждут в очереди — освободите место под таблицей',
      };
    }
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

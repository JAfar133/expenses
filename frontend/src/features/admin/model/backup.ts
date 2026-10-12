import { formatMoney } from '../../../shared/utils/money.ts';
import type { AdminBackup } from '../api/admin.api.ts';

/** File size for people: 512 Б, 48,3 КБ, 12,5 МБ. */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${formatMoney(bytes / 1024, 1)} КБ`;
  return `${formatMoney(bytes / (1024 * 1024), 1)} МБ`;
}

/** How long ago: «меньше часа назад», «9 ч назад», «3 дн. назад». */
export function formatAge(hours: number | null): string {
  if (hours === null) return '';
  if (hours < 1) return 'меньше часа назад';
  if (hours < 48) return `${Math.floor(hours)} ч назад`;
  return `${Math.floor(hours / 24)} дн. назад`;
}

export const STATE_TEXT: Record<AdminBackup['state'], string> = {
  ok: 'Всё в порядке',
  stale: 'Давно не было копии',
  failed: 'Последний запуск закончился ошибкой',
  unknown: 'Нет данных о бэкапах',
};

export const RUN_ERROR_TEXT: Record<string, string> = {
  dump_failed: 'не удалось снять дамп базы',
  verify_failed: 'дамп не прошёл проверку',
  upload_failed: 'копия не загрузилась в OneDrive (локальная копия есть)',
  unexpected: 'непредвиденная ошибка',
};

export const REMOTE_TEXT: Record<'ok' | 'failed' | 'off', string> = {
  ok: 'есть',
  failed: 'не загрузилась',
  off: 'не используется',
};

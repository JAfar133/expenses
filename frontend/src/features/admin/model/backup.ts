import { formatMoney } from '../../../shared/utils/money.ts';

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

/** Short local date and time without the year: «12.10 22:15». */
export function formatShortDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Very short reasons of a failed run. */
export const RUN_ERROR_TEXT: Record<string, string> = {
  dump_failed: 'дамп не снят',
  verify_failed: 'дамп не прошёл проверку',
  upload_failed: 'не загрузилась в OneDrive',
  unexpected: 'непредвиденная ошибка',
};

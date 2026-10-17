import type { ImportStatus } from '../api/integrations.api.ts';

const pad = (value: number) => String(value).padStart(2, '0');

/** «17.10.2026» in the viewer's local time. */
export function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()}`;
}

/** «Использован сегодня» / «вчера» / «15.10.2026» / «не использовался». */
export function lastUsedText(iso: string | null, now = new Date()): string {
  if (!iso) return 'не использовался';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const day = (value: Date) =>
    new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
  const days = Math.round((day(now) - day(date)) / 86_400_000);
  if (days === 0) return 'использован сегодня';
  if (days === 1) return 'использован вчера';
  return `использован ${formatDate(iso)}`;
}

/** «17.10 14:30» for the list of imports. */
export function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** A status in plain words; `warn`: the owner has to do something. */
export function statusOf(
  status: ImportStatus,
  cardLast4: string | null,
): { text: string; tone: 'ok' | 'warn' | 'muted' } {
  const digits = cardLast4 ?? '';
  switch (status) {
    case 'created':
      return { text: 'Добавлено', tone: 'ok' };
    case 'parse_error':
      return { text: 'Не распознано', tone: 'muted' };
    case 'unsupported':
      return { text: 'Другой вид уведомления', tone: 'muted' };
    case 'card_not_found':
      return {
        text: `Нет карты с цифрами ${digits} · укажите их в настройках карты`,
        tone: 'warn',
      };
    case 'card_ambiguous':
      return { text: `Несколько карт с цифрами ${digits}`, tone: 'warn' };
    default:
      return { text: 'Ошибка', tone: 'warn' };
  }
}

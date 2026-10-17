import type { ImportLogEntry } from '../api/integrations.api.ts';

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

/** «17 окт., 13:14» */
export function shortTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat('ru', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

const SOURCES: Record<string, string> = { idbank: 'IDBank', apple_wallet: 'Apple Wallet' };

/** The source as a person knows it; an unknown one is shown as it is. */
export const sourceLabel = (source: string) => SOURCES[source] ?? source;

export type Tone = 'ok' | 'warn' | 'muted' | 'info';

/** A status of a logged request in plain words, with a line that explains it. */
export function logStatus(entry: ImportLogEntry): { text: string; tone: Tone; detail?: string } {
  const digits = entry.parsed?.cardLast4 ?? '';
  const match = entry.match;
  switch (entry.status) {
    case 'created':
      return { text: 'Добавлено', tone: 'ok' };
    case 'duplicate': {
      if (!match || 'mergedWalletEvents' in match) return { text: 'Уже было', tone: 'info' };
      const renamed = match.renamed
        ? `, название обновлено: ${match.renamed.from} → ${match.renamed.to}`
        : '';
      return {
        text: 'Уже было',
        tone: 'info',
        detail: `совпало с операцией из ${sourceLabel(match.source)}${renamed}`,
      };
    }
    case 'merged':
      return { text: 'Объединено', tone: 'muted', detail: 'взято банковским уведомлением' };
    case 'unrecognized':
      return {
        text: 'Не распознано',
        tone: 'warn',
        detail: `${entry.error ? `${entry.error}. ` : ''}Данных недостаточно: запрос сохранён, смотрите JSON`,
      };
    case 'parse_error':
      return { text: 'Не удалось разобрать', tone: 'warn', detail: entry.error ?? undefined };
    case 'unsupported':
      return { text: 'Другой вид уведомления', tone: 'muted' };
    case 'card_not_found':
      return {
        text: `Нет карты с цифрами ${digits} · укажите их в настройках карты`,
        tone: 'warn',
      };
    case 'card_ambiguous':
      return { text: `Несколько карт с цифрами ${digits}`, tone: 'warn' };
    case 'unknown_source':
      return { text: 'Неизвестный источник', tone: 'warn', detail: entry.error ?? undefined };
    default:
      return { text: 'Ошибка', tone: 'warn', detail: entry.error ?? undefined };
  }
}

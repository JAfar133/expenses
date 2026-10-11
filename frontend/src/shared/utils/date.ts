/** Часовой пояс пользователя (IANA). Пока не задан, используется пояс устройства. */
let appTimezone: string | undefined;

const isValidTimezone = (value: string) => {
  try {
    new Intl.DateTimeFormat('en', { timeZone: value });
    return true;
  } catch {
    return false;
  }
};

/** Задаёт часовой пояс, по которому определяется «сегодня». Некорректное значение сбрасывает на пояс устройства. */
export function setAppTimezone(timezone: string | undefined): void {
  appTimezone = timezone && isValidTimezone(timezone) ? timezone : undefined;
}

/**
 * Сегодняшняя дата в формате YYYY-MM-DD: в часовом поясе пользователя, а если он не задан, в поясе устройства
 * (без смещения из-за UTC).
 */
export function todayIso(now = new Date()): string {
  if (appTimezone) {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: appTimezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now);
  }
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

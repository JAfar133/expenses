export interface TimezoneOption {
  value: string;
  /** «Asia/Yerevan (UTC+4)» */
  label: string;
}

/** Смещение в минутах и подпись вида «UTC+4» или «UTC+5:30»; null, если браузер не знает такого пояса. */
function describeOffset(timezone: string, at: Date): { minutes: number; label: string } | null {
  let raw: string;
  try {
    const parts = new Intl.DateTimeFormat('en', {
      timeZone: timezone,
      timeZoneName: 'longOffset',
    }).formatToParts(at);
    raw = parts.find((part) => part.type === 'timeZoneName')?.value ?? 'GMT';
  } catch {
    return null;
  }

  const match = /^GMT(?:([+-])(\d{2}):(\d{2}))?$/.exec(raw);
  if (!match || !match[1]) return { minutes: 0, label: 'UTC' };

  const sign = match[1] === '-' ? -1 : 1;
  const hours = Number(match[2]);
  const minutes = match[3] === '00' ? '' : `:${match[3]}`;
  return {
    minutes: sign * (hours * 60 + Number(match[3])),
    label: `UTC${match[1]}${hours}${minutes}`,
  };
}

/** Смещение пояса в виде «UTC+4» или «UTC+5:30»; для UTC просто «UTC». Неизвестный пояс: пустая строка. */
export function offsetLabel(timezone: string, at = new Date()): string {
  return describeOffset(timezone, at)?.label ?? '';
}

/** Часовой пояс устройства. */
export const deviceTimezone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone;

/**
 * Все часовые пояса браузера, от западных к восточным; `current` всегда есть в списке, даже если браузер его не знает.
 */
export function timezoneOptions(current: string, at = new Date()): TimezoneOption[] {
  const known =
    (Intl as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf?.('timeZone') ??
    [];
  const zones = new Set([...known, current, 'UTC']);

  const withOffset = [...zones].map((value) => {
    const offset = describeOffset(value, at);
    // Пояс, который браузер не знает (например, сохранён на другом устройстве), остаётся в списке без смещения
    return {
      value,
      total: offset?.minutes ?? 0,
      label: offset ? `${value} (${offset.label})` : value,
    };
  });

  return withOffset
    .sort((a, b) => a.total - b.total || a.value.localeCompare(b.value))
    .map(({ value, label }) => ({ value, label }));
}

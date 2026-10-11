export interface TimezoneOption {
  value: string;
  /** «Asia/Yerevan (UTC+4)» */
  label: string;
}

/** Offset in minutes and a label like "UTC+4" or "UTC+5:30"; null if the browser does not know the zone. */
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

/** Zone offset as "UTC+4" or "UTC+5:30"; just "UTC" for UTC. Unknown zone: empty string. */
export function offsetLabel(timezone: string, at = new Date()): string {
  return describeOffset(timezone, at)?.label ?? '';
}

/** The device time zone. */
export const deviceTimezone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone;

/**
 * All browser time zones, west to east; `current` is always in the list even if the browser does not know it.
 */
export function timezoneOptions(current: string, at = new Date()): TimezoneOption[] {
  const known =
    (Intl as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf?.('timeZone') ??
    [];
  const zones = new Set([...known, current, 'UTC']);

  const withOffset = [...zones].map((value) => {
    const offset = describeOffset(value, at);
    // A zone the browser does not know (e.g. saved on another device) stays in the list without an offset
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

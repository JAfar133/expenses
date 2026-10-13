import { offsetLabel } from './timezones.ts';

/** A short list of popular zones for the time zone select. */
export const POPULAR_TIMEZONES = [
  'Asia/Yerevan',
  'Europe/Moscow',
  'Europe/Kiev',
  'Europe/London',
  'Europe/Berlin',
  'Asia/Dubai',
  'Asia/Tbilisi',
  'Asia/Almaty',
  'America/New_York',
  'UTC',
] as const;

export const DEFAULT_CHOICE = 'default';
export const DEVICE_CHOICE = 'device';

export interface TimezoneChoice {
  value: string;
  label: string;
}

/**
 * Options of the time zone select: «По умолчанию», «Как на этом устройстве (…)», then the popular zones as
 * «Zone (UTC+N)». The zone saved in the account is added when it is not among them, so it is always shown.
 */
export function timezoneChoices(
  current: string,
  device: string,
  /** The configured default zone, when the server tells it */
  defaultZone?: string,
  at = new Date(),
): TimezoneChoice[] {
  const zones: string[] = [...POPULAR_TIMEZONES];
  if (!zones.includes(current)) zones.push(current);
  const named = (zone: string) => {
    const offset = offsetLabel(zone, at);
    return offset ? `${zone} (${offset})` : zone;
  };
  return [
    {
      value: DEFAULT_CHOICE,
      label: defaultZone ? `По умолчанию (${named(defaultZone)})` : 'По умолчанию',
    },
    { value: DEVICE_CHOICE, label: `Как на этом устройстве (${named(device)})` },
    ...zones.map((zone) => ({ value: zone, label: named(zone) })),
  ];
}

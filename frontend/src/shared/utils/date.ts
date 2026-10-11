/** User time zone (IANA). Until set, the device zone is used. */
let appTimezone: string | undefined;

const isValidTimezone = (value: string) => {
  try {
    new Intl.DateTimeFormat('en', { timeZone: value });
    return true;
  } catch {
    return false;
  }
};

/** Sets the time zone that defines "today". An invalid value resets to the device zone. */
export function setAppTimezone(timezone: string | undefined): void {
  appTimezone = timezone && isValidTimezone(timezone) ? timezone : undefined;
}

/**
 * Today's date as YYYY-MM-DD: in the user's time zone, or the device zone if it is not set
 * (without a UTC shift).
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

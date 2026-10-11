import { useEffect, useState } from 'react';

/**
 * Milliseconds left until `target`. The countdown follows the server clock: the difference between it
 * and the device clock is computed when the response is received (`serverTime` <-> `receivedAt`).
 * Returns null if there is no start time (sync is running right now).
 */
export function useCountdown(
  target: string | null,
  serverTime: string,
  receivedAt: number,
): number | null {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  if (!target) return null;

  const clockOffset = Date.parse(serverTime) - receivedAt;
  return Math.max(0, Date.parse(target) - (now + clockOffset));
}

/** 272000 → «4:32», 59000 → «0:59». */
export function formatCountdown(ms: number): string {
  const totalSeconds = Math.ceil(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = String(totalSeconds % 60).padStart(2, '0');
  return `${minutes}:${seconds}`;
}

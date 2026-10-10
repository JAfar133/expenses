import { useEffect, useState } from 'react';

/**
 * Сколько миллисекунд осталось до `target`. Отсчёт идёт по часам сервера: разница между ними
 * и часами устройства вычисляется в момент получения ответа (`serverTime` ↔ `receivedAt`).
 * Возвращает null, если времени запуска нет (синхронизация идёт прямо сейчас).
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

export interface LoginThrottleOptions {
  /** Сколько неудачных попыток подряд допускается для пары «логин + адрес» */
  maxPerUser?: number;
  /** Сколько неудачных попыток допускается с одного адреса (подбор разных логинов) */
  maxPerIp?: number;
  windowMs?: number;
  now?: () => number;
}

/**
 * Ограничение подбора пароля. Хранится в памяти процесса: приложение работает в одном экземпляре,
 * а после перезапуска счётчики сбрасываются (это не страшно: перезапуск делает владелец).
 */
export class LoginThrottle {
  private readonly failures = new Map<string, number[]>();
  private readonly maxPerUser: number;
  private readonly maxPerIp: number;
  private readonly windowMs: number;
  private readonly now: () => number;

  constructor(options: LoginThrottleOptions = {}) {
    this.maxPerUser = options.maxPerUser ?? 5;
    this.maxPerIp = options.maxPerIp ?? 20;
    this.windowMs = options.windowMs ?? 15 * 60_000;
    this.now = options.now ?? Date.now;
  }

  /** Через сколько секунд можно пробовать снова; 0, если попытка разрешена. */
  retryAfterSeconds(username: string, ip = 'unknown'): number {
    const waits = [
      this.waitFor(userKey(username, ip), this.maxPerUser),
      this.waitFor(ipKey(ip), this.maxPerIp),
    ];
    return Math.ceil(Math.max(...waits) / 1000);
  }

  recordFailure(username: string, ip = 'unknown'): void {
    for (const key of [userKey(username, ip), ipKey(ip)]) {
      this.failures.set(key, [...this.recent(key), this.now()]);
    }
  }

  /** Успешный вход снимает счётчик пары «логин + адрес». */
  recordSuccess(username: string, ip = 'unknown'): void {
    this.failures.delete(userKey(username, ip));
  }

  private recent(key: string): number[] {
    const cutoff = this.now() - this.windowMs;
    const recent = (this.failures.get(key) ?? []).filter((time) => time > cutoff);
    if (recent.length === 0) this.failures.delete(key);
    return recent;
  }

  private waitFor(key: string, limit: number): number {
    const recent = this.recent(key);
    if (recent.length < limit) return 0;
    // Блокировка снимается, когда самая старая из значимых попыток выйдет из окна
    const oldestCounted = recent[recent.length - limit]!;
    return Math.max(oldestCounted + this.windowMs - this.now(), 0);
  }
}

const userKey = (username: string, ip: string) => `user:${username}|${ip}`;
const ipKey = (ip: string) => `ip:${ip}`;

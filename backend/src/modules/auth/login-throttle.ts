export interface LoginThrottleOptions {
  /** How many consecutive failed attempts are allowed for a "login + address" pair */
  maxPerUser?: number;
  /** How many failed attempts are allowed from one address (guessing different logins) */
  maxPerIp?: number;
  windowMs?: number;
  now?: () => number;
}

/**
 * Password guessing limit. Kept in process memory: the app runs as a single instance,
 * and counters reset after a restart (this is fine: the owner does the restarting).
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

  /** In how many seconds one may try again; 0 if the attempt is allowed. */
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

  /** A successful login clears the counter of the "login + address" pair. */
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
    // The block is lifted when the oldest of the relevant attempts leaves the window
    const oldestCounted = recent[recent.length - limit]!;
    return Math.max(oldestCounted + this.windowMs - this.now(), 0);
  }
}

const userKey = (username: string, ip: string) => `user:${username}|${ip}`;
const ipKey = (ip: string) => `ip:${ip}`;

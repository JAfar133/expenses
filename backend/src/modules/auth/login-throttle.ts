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
  private lastPrune = 0;

  constructor(options: LoginThrottleOptions = {}) {
    this.maxPerUser = options.maxPerUser ?? 5;
    this.maxPerIp = options.maxPerIp ?? 20;
    this.windowMs = options.windowMs ?? 15 * 60_000;
    this.now = options.now ?? Date.now;
  }

  /**
   * Checks the limit and, if the attempt is allowed, counts it right away as a failure.
   * Counting before the (slow) password check keeps parallel requests from all seeing the same counter.
   * A successful login takes the attempt back with `recordSuccess`. Returns the wait in seconds; 0 if allowed.
   */
  reserve(username: string, ip = 'unknown'): number {
    this.pruneExpired();
    const wait = this.retryAfterSeconds(username, ip);
    if (wait === 0) this.recordFailure(username, ip);
    return wait;
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

  /**
   * A successful login clears the counter of the "login + address" pair
   * and takes back the attempt reserved for the address.
   */
  recordSuccess(username: string, ip = 'unknown'): void {
    this.failures.delete(userKey(username, ip));
    const attempts = this.failures.get(ipKey(ip));
    attempts?.pop();
    if (attempts?.length === 0) this.failures.delete(ipKey(ip));
  }

  /** Number of tracked keys (for tests and diagnostics). */
  get trackedKeys(): number {
    return this.failures.size;
  }

  /** Drops expired keys, at most once per window fraction: memory does not grow with one-off guesses. */
  private pruneExpired(): void {
    const now = this.now();
    if (now - this.lastPrune < PRUNE_INTERVAL_MS) return;
    this.lastPrune = now;
    for (const key of [...this.failures.keys()]) this.recent(key);
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

const PRUNE_INTERVAL_MS = 60_000;

const userKey = (username: string, ip: string) => `user:${username}|${ip}`;
const ipKey = (ip: string) => `ip:${ip}`;

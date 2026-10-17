/** A simple fixed-window counter in memory: enough to stop a runaway client or guessing of keys. */
export class RateLimiter {
  private readonly windows = new Map<string, { count: number; resetsAt: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** Counts one request; false when the limit of the window is exceeded. */
  allow(key: string): boolean {
    const now = this.now();
    const current = this.windows.get(key);
    if (!current || current.resetsAt <= now) {
      this.windows.set(key, { count: 1, resetsAt: now + this.windowMs });
      this.sweep(now);
      return true;
    }
    current.count += 1;
    return current.count <= this.limit;
  }

  private sweep(now: number): void {
    if (this.windows.size < 1000) return;
    for (const [key, window] of this.windows) {
      if (window.resetsAt <= now) this.windows.delete(key);
    }
  }
}

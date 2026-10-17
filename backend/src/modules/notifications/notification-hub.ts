/** What the open apps of a person are told: the new number for the badge. */
export interface HubEvent {
  unread: number;
}

type Listener = (event: HubEvent) => void;

/**
 * The people who have the app open right now (one listener per open tab). A new notification is pushed to them at once,
 * so the badge changes without waiting for the next poll. Memory only: a restart drops the listeners and the apps
 * reconnect by themselves.
 */
export class NotificationHub {
  private readonly listeners = new Map<string, Set<Listener>>();

  /** Starts listening for a person; returns the function that stops it. */
  subscribe(userId: string, listener: Listener): () => void {
    const set = this.listeners.get(userId) ?? new Set<Listener>();
    set.add(listener);
    this.listeners.set(userId, set);
    return () => {
      set.delete(listener);
      if (set.size === 0) this.listeners.delete(userId);
    };
  }

  /** Tells every open tab of the person; a broken tab never stops the others. */
  publish(userId: string, event: HubEvent): void {
    for (const listener of this.listeners.get(userId) ?? []) {
      try {
        listener(event);
      } catch {
        // That tab is gone; its own close handler removes it
      }
    }
  }

  /** How many tabs are open (for tests and the log) */
  get size(): number {
    let total = 0;
    for (const set of this.listeners.values()) total += set.size;
    return total;
  }
}

/** A browser subscription as the browser gives it. */
export interface PushTarget {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

/** What a device is shown. Small: a push message may carry about 4 KB. */
export interface PushPayload {
  /** The notification row: it is also the `tag`, so the same one never shows twice */
  id: string;
  type: string;
  title: string;
  body: string;
  /** A path of the app opened by a tap */
  url: string;
  /** The number for the badge on the icon */
  unread: number;
  /** When it happened (ms) */
  ts: number;
}

/** The result of one try. `status` is the push service's HTTP status, null when it could not be reached. */
export type SendResult = { ok: true } | { ok: false; status: number | null };

/** The only place that talks to the push services; the tests put a fake one. */
export interface PushSender {
  send(target: PushTarget, payload: PushPayload): Promise<SendResult>;
}

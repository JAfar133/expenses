import webpush from 'web-push';
import type { PushPayload, PushSender, PushTarget, SendResult } from './push.types.ts';

export interface WebPushSenderOptions {
  publicKey: string;
  privateKey: string;
  /** `mailto:…` or the site address */
  subject: string;
}

/** A message is worth delivering for half a day; later it is stale (the app shows it in the feed anyway). */
const TTL_SECONDS = 12 * 60 * 60;
const TIMEOUT_MS = 10_000;

/** Sends through the push services with the `web-push` library (encryption and the VAPID signature). */
export class WebPushSender implements PushSender {
  /** Throws when the keys or the subject are not valid: better at start than at the first message. */
  constructor(private readonly options: WebPushSenderOptions) {
    webpush.setVapidDetails(options.subject, options.publicKey, options.privateKey);
  }

  async send(target: PushTarget, payload: PushPayload): Promise<SendResult> {
    try {
      await webpush.sendNotification(target, JSON.stringify(payload), {
        TTL: TTL_SECONDS,
        urgency: 'normal',
        timeout: TIMEOUT_MS,
        vapidDetails: {
          subject: this.options.subject,
          publicKey: this.options.publicKey,
          privateKey: this.options.privateKey,
        },
      });
      return { ok: true };
    } catch (error) {
      const status = (error as { statusCode?: unknown }).statusCode;
      return { ok: false, status: typeof status === 'number' ? status : null };
    }
  }
}

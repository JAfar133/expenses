/** What a bank notification means, once read. */
export type ParsedNotification =
  | { kind: 'expense'; purchase: ParsedPurchase }
  /** A notification of a kind we do not import (not a purchase, or a type not supported yet) */
  | { kind: 'unsupported' }
  /** It looks like a supported kind, but the text is not readable: nothing is created */
  | { kind: 'error'; reason: string };

export interface ParsedPurchase {
  /** The amount of the purchase (never the balance) and its currency */
  amount: number;
  currency: string;
  merchant: string;
  /** The last four digits of the card, when the source says them */
  cardLast4?: string;
  /** What the source calls the card (Apple Wallet: its own name for it); a hint, never trusted as digits */
  cardHint?: string;
  /** The source's own category of the operation; a hint for the category of the expense */
  categoryHint?: string;
  /** The source's own id of the operation, if it gives one */
  transactionId?: string;
  /** When the operation happened, as a moment in time and as the date shown in the bank's own time zone */
  occurredAt: Date;
  localDate: string;
}

/** What a request carries: the three common fields and everything else as it came. */
export interface NotificationInput {
  title: string;
  body: string;
  /** The whole JSON of the request (unknown fields included) */
  fields: Record<string, unknown>;
  /** When the server got it */
  receivedAt: Date;
  /** The time zone of the person the expense is made for (a date without a zone is read in it) */
  timezone: string;
}

/** One source's notifications. A new source is a new parser in `registry.ts`; nothing else changes. */
export interface NotificationParser {
  /** The `source` the client sends */
  source: string;
  parse(input: NotificationInput): ParsedNotification;
}

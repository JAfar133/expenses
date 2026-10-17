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
  /** The last four digits of the card */
  cardLast4: string;
  /** When the operation happened, as a moment in time and as the date shown in the bank's own time zone */
  occurredAt: Date;
  localDate: string;
}

/** One bank's notifications. A new bank is a new parser in `registry.ts`; nothing else changes. */
export interface NotificationParser {
  /** The `source` the client sends */
  source: string;
  parse(title: string, body: string): ParsedNotification;
}

import { appleWalletParser } from './apple-wallet.ts';
import { idbankParser } from './idbank.ts';
import type { NotificationParser } from './parser.types.ts';

const PARSERS: NotificationParser[] = [idbankParser, appleWalletParser];

/** The parser of a source by the `source` the client sends; undefined for an unknown source. */
export const parserFor = (source: string): NotificationParser | undefined =>
  PARSERS.find((parser) => parser.source === source.trim().toLowerCase());

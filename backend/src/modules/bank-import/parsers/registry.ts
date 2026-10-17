import { idbankParser } from './idbank.ts';
import type { NotificationParser } from './parser.types.ts';

const PARSERS: NotificationParser[] = [idbankParser];

/** The parser of a bank by the `source` the client sends; undefined for an unknown bank. */
export const parserFor = (source: string): NotificationParser | undefined =>
  PARSERS.find((parser) => parser.source === source.trim().toLowerCase());

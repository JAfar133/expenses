/** A text field of a request: a string as it is, a number as text, an object as JSON; anything else is not text. */
export function textOf(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'object' && value !== null) return JSON.stringify(value);
  return undefined;
}

const MAX_DEPTH = 4;
const MAX_KEYS = 60;
const MAX_ITEMS = 50;
const MAX_TEXT = 2000;
/** Anything that looks like one of our keys never reaches the log */
const KEY_LIKE = /etk_[A-Za-z0-9_-]{16,}/g;

/**
 * The request as it came, made safe to keep: unknown fields stay, but the depth, the number of fields and the length
 * of texts are limited, and anything that looks like an API key is blanked.
 */
export function sanitizePayload(value: Record<string, unknown>): Record<string, unknown> {
  return clean(value, 0) as Record<string, unknown>;
}

function clean(value: unknown, depth: number): unknown {
  if (typeof value === 'string') {
    const text = value.length > MAX_TEXT ? `${value.slice(0, MAX_TEXT)}…` : value;
    return text.replace(KEY_LIKE, '[key removed]');
  }
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return value;
  if (depth >= MAX_DEPTH) return '[too deep]';
  if (Array.isArray(value)) return value.slice(0, MAX_ITEMS).map((item) => clean(item, depth + 1));
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .slice(0, MAX_KEYS);
    return Object.fromEntries(
      entries.map(([key, item]) => [key.slice(0, 80), clean(item, depth + 1)]),
    );
  }
  return String(value);
}

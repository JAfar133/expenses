/** An earlier expense of the group: its name and the category it went to (newest first). */
export interface PastExpense {
  name: string;
  category: string;
}

/** Words that say nothing about which shop it is. */
const NOISE = new Set([
  'llc',
  'ltd',
  'cjsc',
  'ojsc',
  'inc',
  'co',
  'shop',
  'store',
  'market',
  'ооо',
  'зао',
  'оао',
  'ип',
  'магазин',
]);
/** A shared word shorter than this is too common to tell two shops apart. */
const MIN_SHARED_WORD = 4;

/** «URARTU ZAQYAN, AM» → ['urartu', 'zaqyan']: lower case, letters and digits only, no noise, no bare numbers. */
export function merchantWords(name: string): string[] {
  return (name.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter(
    (word) => !NOISE.has(word) && !/^\d+$/.test(word),
  );
}

/**
 * The category the group already uses for this shop. The same name wins; otherwise a name that is part of the other
 * («Urartu» and «URARTU ZAQYAN») counts as the same shop, if what they share is a real word, not «a» or «of».
 * The most specific match wins, and among equal ones the newest expense. `undefined` when nothing is alike.
 */
export function categoryForMerchant(merchant: string, history: PastExpense[]): string | undefined {
  const wanted = merchantWords(merchant);
  if (wanted.length === 0) return undefined;

  let best: { score: number; category: string } | undefined;
  for (const past of history) {
    const score = similarity(wanted, merchantWords(past.name));
    // `history` is newest first: a later entry replaces the best one only when it is strictly better
    if (score > 0 && (!best || score > best.score)) best = { score, category: past.category };
  }
  return best?.category;
}

/** Whether two names are one shop (the same words, or one is part of the other by a real word). */
export const sameShop = (a: string, b: string): boolean =>
  similarity(merchantWords(a), merchantWords(b)) > 0;

/** 0: not alike; 3: the same words; 1..2: one name is part of the other (the closer in length, the higher). */
function similarity(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const setA = new Set(a);
  const setB = new Set(b);
  const shared = [...setA].filter((word) => setB.has(word));
  if (shared.length === setA.size && shared.length === setB.size) return 3;
  const part = shared.length === setA.size || shared.length === setB.size;
  if (!part || !shared.some((word) => word.length >= MIN_SHARED_WORD)) return 0;
  return 1 + shared.length / Math.max(setA.size, setB.size);
}

/** What the group made of this shop before, from earlier imports (the newest first). */
export interface Remembered {
  /** The name a person gave it; only for the very same shop name */
  name?: string;
  category: string;
}

/**
 * Corrections are remembered: when a person renamed or re-filed an imported expense, the next import of the same
 * shop gets the same name and category. The very same shop name brings both; a similar one («Urartu» and
 * «URARTU ZAQYAN») only the category, because it may be another branch.
 */
export function rememberedFor(
  merchant: string,
  shops: { merchant: string; name: string; category: string }[],
): Remembered | undefined {
  const wanted = merchantWords(merchant).join(' ');
  if (!wanted) return undefined;
  const exact = shops.find((shop) => merchantWords(shop.merchant).join(' ') === wanted);
  if (exact) return { name: exact.name, category: exact.category };
  const alike = shops.find((shop) => sameShop(shop.merchant, merchant));
  return alike ? { category: alike.category } : undefined;
}

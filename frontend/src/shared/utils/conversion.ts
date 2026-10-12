export type RateList = { currency: string; rate: number }[] | undefined;

/** Drams (the pivot currency) have no decimals; every other currency has cents. */
export const currencyDigits = (code: string, pivot: string) => (code === pivot ? 0 : 2);

/** Price of a currency unit in the pivot currency (drams): 1 for the pivot itself, undefined when unknown. */
export function pivotRate(rates: RateList, code: string, pivot: string): number | undefined {
  if (code === pivot) return 1;
  const rate = rates?.find((item) => item.currency === code)?.rate;
  return rate !== undefined && rate > 0 ? rate : undefined;
}

/** How many `to` units one `from` unit costs, crossing through the pivot currency; undefined when a rate is unknown. */
export function crossRate(
  rates: RateList,
  from: string,
  to: string,
  pivot: string,
): number | undefined {
  const [fromRate, toRate] = [pivotRate(rates, from, pivot), pivotRate(rates, to, pivot)];
  return fromRate === undefined || toRate === undefined ? undefined : fromRate / toRate;
}

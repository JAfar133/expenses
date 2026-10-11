/** Rate: how many drams a unit of currency costs. */
export interface StoredRate {
  currency: string;
  rate: number;
  /** When the rate was received from the source (ISO) */
  fetchedAt: string;
}

export interface RatesSnapshot {
  /** Base currency: amounts are stored in it and Excel is kept in it */
  base: string;
  /** Rates of the available currencies; a currency without a rate has no entry: the user enters the rate manually */
  rates: StoredRate[];
}

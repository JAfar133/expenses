export type RateFetcher = (currencies: string[]) => Promise<Map<string, number>>;

export interface CbaClientOptions {
  /** URL of the Central Bank of Armenia rates JSON: `{"USD":"361.93","RUB":"4.2677",...}` (drams per unit of currency) */
  url: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

const DEFAULT_TIMEOUT_MS = 5000;

/** Loads the official Central Bank of Armenia rates. Currencies without a rate are absent from the response. */
export function createCbaClient({
  url,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  fetchImpl = fetch,
}: CbaClientOptions): RateFetcher {
  return async (currencies) => {
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) {
      throw new Error(`Rates source responded with HTTP ${response.status}`);
    }

    const body = (await response.json()) as Record<string, unknown>;
    const rates = new Map<string, number>();
    for (const currency of currencies) {
      const rate = Number(body[currency]);
      if (Number.isFinite(rate) && rate > 0) rates.set(currency, rate);
    }
    return rates;
  };
}

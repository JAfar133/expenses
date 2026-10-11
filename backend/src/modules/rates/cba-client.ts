export type RateFetcher = (currencies: string[]) => Promise<Map<string, number>>;

export interface CbaClientOptions {
  /** Адрес JSON с курсами ЦБ Армении: `{"USD":"361.93","RUB":"4.2677",...}` (драммы за единицу валюты) */
  url: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

const DEFAULT_TIMEOUT_MS = 5000;

/** Загружает официальные курсы ЦБ Армении. Валюты без курса в ответ не попадают. */
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

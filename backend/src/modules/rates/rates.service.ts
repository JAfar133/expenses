import type { RateFetcher } from './cba-client.ts';
import type { RatesRepository } from './rates.repository.ts';
import type { RatesSnapshot, StoredRate } from './rates.types.ts';

const RETRY_MS = 5 * 60_000;

export interface RatesServiceOptions {
  repository: Pick<RatesRepository, 'list' | 'save'>;
  fetchRates: RateFetcher;
  /** Base currency (drams) and the currencies in which expenses can be entered */
  base: string;
  currencies: string[];
  /** How long a rate is considered fresh */
  refreshMs: number;
  /** How long to wait before retrying if the source did not respond (5 minutes by default) */
  retryMs?: number;
  now?: () => number;
  logger?: { warn: (fields: object, message: string) => void };
}

/**
 * Currency rates to the dram. Fresh rates are fetched from the source at most once per `refreshMs` and saved in the database.
 * If the source is unavailable, the last known rate is used: an expense can still be entered, and the rate can be corrected manually.
 */
export class RatesService {
  private cache = new Map<string, StoredRate>();
  private loaded = false;
  private refreshedAt = 0;
  private refreshing?: Promise<void>;
  private readonly now: () => number;

  constructor(private readonly options: RatesServiceOptions) {
    this.now = options.now ?? Date.now;
  }

  get base(): string {
    return this.options.base;
  }

  get currencies(): string[] {
    return this.options.currencies;
  }

  /** Rates for the form. Never throws: a currency without a rate is simply absent from the list. */
  async snapshot(): Promise<RatesSnapshot> {
    await this.ensureFresh();
    return {
      base: this.options.base,
      rates: this.foreignCurrencies().flatMap((currency) => this.cache.get(currency) ?? []),
    };
  }

  /** Rate of one currency; always 1 for the base one; undefined if there is no rate. */
  async rateOf(currency: string): Promise<number | undefined> {
    if (currency === this.options.base) return 1;
    await this.ensureFresh();
    return this.cache.get(currency)?.rate;
  }

  private foreignCurrencies(): string[] {
    return this.options.currencies.filter((currency) => currency !== this.options.base);
  }

  private async ensureFresh(): Promise<void> {
    await this.loadStored();
    if (this.now() - this.refreshedAt < this.options.refreshMs) return;

    // Concurrent requests wait for the same exchange with the source
    this.refreshing ??= this.refresh().finally(() => {
      this.refreshing = undefined;
    });
    await this.refreshing;
  }

  /** Last saved rates: needed after a restart until the source responds. */
  private async loadStored(): Promise<void> {
    if (this.loaded) return;
    try {
      for (const stored of await this.options.repository.list()) {
        this.cache.set(stored.currency, stored);
      }
      this.loaded = true;
    } catch (error) {
      this.options.logger?.warn({ err: error }, 'Failed to read stored exchange rates');
    }
  }

  private async refresh(): Promise<void> {
    this.refreshedAt = this.now();
    try {
      const fetched = await this.options.fetchRates(this.foreignCurrencies());
      const fetchedAt = new Date(this.now()).toISOString();
      const fresh = [...fetched].map(([currency, rate]) => ({ currency, rate, fetchedAt }));

      for (const item of fresh) this.cache.set(item.currency, item);
      await this.options.repository
        .save(fresh)
        .catch((error) =>
          this.options.logger?.warn({ err: error }, 'Failed to save exchange rates'),
        );
    } catch (error) {
      // An unavailable source is not polled on every request, but we do not wait the full period before retrying either
      this.refreshedAt = this.now() - this.options.refreshMs + (this.options.retryMs ?? RETRY_MS);
      this.options.logger?.warn(
        { err: error },
        'Failed to fetch exchange rates, using the last known ones',
      );
    }
  }
}

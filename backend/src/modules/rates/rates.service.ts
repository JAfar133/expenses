import type { RateFetcher } from './cba-client.ts';
import type { RatesRepository } from './rates.repository.ts';
import type { RatesSnapshot, StoredRate } from './rates.types.ts';

const RETRY_MS = 5 * 60_000;

export interface RatesServiceOptions {
  repository: Pick<RatesRepository, 'list' | 'save'>;
  fetchRates: RateFetcher;
  /** Базовая валюта (драмы) и валюты, в которых можно вводить расходы */
  base: string;
  currencies: string[];
  /** Как долго курс считается свежим */
  refreshMs: number;
  /** Через сколько повторить, если источник не ответил (по умолчанию 5 минут) */
  retryMs?: number;
  now?: () => number;
  logger?: { warn: (fields: object, message: string) => void };
}

/**
 * Курсы валют к драму. Свежие курсы берутся у источника не чаще, чем раз в `refreshMs`, и сохраняются в базе.
 * Если источник недоступен, используется последний известный курс: расход можно ввести, а курс при желании поправить вручную.
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

  /** Курсы для формы. Не бросает ошибок: без курса валюта просто отсутствует в списке. */
  async snapshot(): Promise<RatesSnapshot> {
    await this.ensureFresh();
    return {
      base: this.options.base,
      rates: this.foreignCurrencies().flatMap((currency) => this.cache.get(currency) ?? []),
    };
  }

  /** Курс одной валюты; для базовой всегда 1; undefined, если курса нет. */
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

    // Параллельные запросы ждут один и тот же обмен с источником
    this.refreshing ??= this.refresh().finally(() => {
      this.refreshing = undefined;
    });
    await this.refreshing;
  }

  /** Последние сохранённые курсы: нужны после перезапуска, пока источник не ответил. */
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
      // Недоступный источник не опрашиваем на каждый запрос, но и не ждём полного срока до повтора
      this.refreshedAt = this.now() - this.options.refreshMs + (this.options.retryMs ?? RETRY_MS);
      this.options.logger?.warn(
        { err: error },
        'Failed to fetch exchange rates, using the last known ones',
      );
    }
  }
}

/** Курс: сколько драмм стоит единица валюты. */
export interface StoredRate {
  currency: string;
  rate: number;
  /** Когда курс получен от источника (ISO) */
  fetchedAt: string;
}

export interface RatesSnapshot {
  /** Базовая валюта: в ней хранятся суммы и ведётся Excel */
  base: string;
  /** Курсы доступных валют; для валюты без курса записи нет: пользователь вводит курс вручную */
  rates: StoredRate[];
}

import { describe, expect, it, vi } from 'vitest';
import { createCbaClient, type RateFetcher } from '../../src/modules/rates/cba-client.ts';
import { RatesService } from '../../src/modules/rates/rates.service.ts';
import type { StoredRate } from '../../src/modules/rates/rates.types.ts';

const HOUR = 3_600_000;

function setup(fetchRates: RateFetcher, stored: StoredRate[] = []) {
  let now = 1_000_000_000;
  const saved: StoredRate[][] = [];
  const service = new RatesService({
    repository: {
      list: async () => stored,
      save: async (rates) => void saved.push(rates),
    },
    fetchRates,
    base: 'AMD',
    currencies: ['AMD', 'USD', 'RUB'],
    refreshMs: 6 * HOUR,
    now: () => now,
  });
  return { service, saved, advance: (ms: number) => (now += ms) };
}

const source = (rates: Record<string, number>) =>
  vi.fn<RateFetcher>(async (currencies) => {
    return new Map(currencies.flatMap((c) => (c in rates ? [[c, rates[c]!] as const] : [])));
  });

describe('RatesService', () => {
  it('базовая валюта всегда 1 и источник не опрашивает', async () => {
    const fetchRates = source({});
    const { service } = setup(fetchRates);

    expect(await service.rateOf('AMD')).toBe(1);
    expect(fetchRates).not.toHaveBeenCalled();
  });

  it('берёт курс у источника, сохраняет в базе и не опрашивает чаще refreshMs', async () => {
    const fetchRates = source({ USD: 380, RUB: 4.5 });
    const { service, saved, advance } = setup(fetchRates);

    expect(await service.rateOf('USD')).toBe(380);
    await service.rateOf('RUB');
    advance(5 * HOUR);
    await service.snapshot();

    expect(fetchRates).toHaveBeenCalledTimes(1);
    expect(saved[0]!.map((r) => r.currency).sort()).toEqual(['RUB', 'USD']);

    advance(2 * HOUR);
    await service.rateOf('USD');
    expect(fetchRates).toHaveBeenCalledTimes(2);
  });

  it('параллельные запросы делят один обмен с источником', async () => {
    const fetchRates = source({ USD: 380 });
    const { service } = setup(fetchRates);

    await Promise.all([service.rateOf('USD'), service.snapshot(), service.rateOf('RUB')]);

    expect(fetchRates).toHaveBeenCalledTimes(1);
  });

  it('если источник недоступен, использует последний сохранённый курс', async () => {
    const stored = [{ currency: 'USD', rate: 375, fetchedAt: '2026-10-01T00:00:00.000Z' }];
    const { service } = setup(async () => Promise.reject(new Error('offline')), stored);

    expect(await service.rateOf('USD')).toBe(375);
    expect((await service.snapshot()).rates).toEqual(stored);
  });

  it('без источника и без сохранённого курса курса нет, ошибок нет', async () => {
    const { service } = setup(async () => Promise.reject(new Error('offline')));

    expect(await service.rateOf('USD')).toBeUndefined();
    expect((await service.snapshot()).rates).toEqual([]);
  });

  it('после сбоя источник опрашивается снова раньше полного срока', async () => {
    const fetchRates = vi
      .fn<RateFetcher>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue(new Map([['USD', 380]]));
    const { service, advance } = setup(fetchRates);

    expect(await service.rateOf('USD')).toBeUndefined();
    advance(6 * 60_000);

    expect(await service.rateOf('USD')).toBe(380);
  });

  it('курс не из списка валют не появляется в ответе', async () => {
    const { service } = setup(source({ USD: 380, GBP: 478 }));

    expect((await service.snapshot()).rates.map((r) => r.currency)).toEqual(['USD']);
  });
});

describe('createCbaClient', () => {
  const respond = (body: unknown, ok = true) =>
    vi.fn(async () => ({ ok, status: ok ? 200 : 500, json: async () => body }) as Response);

  it('берёт числа из ответа ЦБ, пропуская пустые и некорректные', async () => {
    const fetchImpl = respond({ USD: '361.93', RUB: '4.2677', EUR: null, AED: 'abc' });
    const client = createCbaClient({ url: 'https://example.test/rates', fetchImpl });

    const rates = await client(['USD', 'RUB', 'EUR', 'AED', 'GBP']);

    expect([...rates]).toEqual([
      ['USD', 361.93],
      ['RUB', 4.2677],
    ]);
  });

  it('ошибка HTTP превращается в исключение', async () => {
    const client = createCbaClient({
      url: 'https://example.test/rates',
      fetchImpl: respond({}, false),
    });

    await expect(client(['USD'])).rejects.toThrow('HTTP 500');
  });

  it('курсы дня пишутся в историю с датой «сегодня»', async () => {
    const days: (string | undefined)[] = [];
    const service = new RatesService({
      repository: { list: async () => [], save: async (_rates, day) => void days.push(day) },
      fetchRates: source({ USD: 380 }),
      base: 'AMD',
      currencies: ['AMD', 'USD'],
      refreshMs: 6 * HOUR,
      today: () => '2026-10-12',
    });

    await service.rateOf('USD');

    expect(days).toEqual(['2026-10-12']);
  });
});

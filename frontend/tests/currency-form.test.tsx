import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AddExpensePage } from '../src/pages/AddExpensePage.tsx';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const ok = (data: unknown, status = 200) => json(status, { success: true, data });

const USER = {
  username: 'misha',
  displayName: 'Миша',
  card: 'Миша',
  canEdit: true,
  role: 'member' as const,
  isAdmin: false,
  timezone: 'Asia/Yerevan',
};

const RATES = {
  base: 'AMD',
  currencies: ['AMD', 'EUR', 'USD'],
  rates: [
    { currency: 'USD', rate: 400, fetchedAt: '2026-10-10T10:00:00.000Z' },
    { currency: 'EUR', rate: 500, fetchedAt: '2026-10-10T10:00:00.000Z' },
  ],
};

let cards: { name: string; currency: string }[];
let posted: Record<string, unknown>[];

beforeEach(() => {
  posted = [];
  cards = [
    { name: 'Миша', currency: 'AMD' },
    { name: 'Доллары', currency: 'USD' },
  ];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/cards') return ok(cards);
      if (url === '/api/categories') return ok(['кафе', 'продукты']);
      if (url === '/api/config') return ok({ currency: 'AMD', baseCurrency: 'AMD' });
      if (url === '/api/rates') return ok(RATES);
      if (url === '/api/name-suggestions') return ok([]);
      if (url.startsWith('/api/analytics/summary')) throw new Error('no summary');
      if (url === '/api/expenses') {
        const body = JSON.parse(String(init?.body));
        posted.push(body);
        return ok(
          {
            id: '1',
            excelStatus: 'synced',
            ...body,
            currency: null,
            reportingAmount: body.amount,
            reportingCurrency: null,
            original: null,
          },
          201,
        );
      }
      throw new Error(`Unexpected request: ${url}`);
    }),
  );
});

afterEach(() => vi.unstubAllGlobals());

async function renderForm() {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter>
        <AddExpensePage user={USER} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  await screen.findByRole('button', { name: 'Добавить расход' });
  await screen.findByLabelText('Валюта');
  return userEvent.setup();
}

const currencySelect = () => screen.getByLabelText('Валюта') as HTMLSelectElement;
const fill = async (person: ReturnType<typeof userEvent.setup>, amount: string) => {
  await person.selectOptions(screen.getByLabelText('Категория'), 'кафе');
  await person.type(screen.getByLabelText('Наименование'), 'Кофе');
  if (amount) await person.type(screen.getByLabelText('Стоимость'), amount);
};
const submit = (person: ReturnType<typeof userEvent.setup>) =>
  person.click(screen.getByRole('button', { name: 'Добавить расход' }));

describe('валюта по карте', () => {
  it('по умолчанию валюта — валюта выбранной карты и меняется вместе с картой', async () => {
    const person = await renderForm();
    expect(currencySelect()).toHaveValue('AMD');

    await person.selectOptions(screen.getByLabelText('Карта'), 'Доллары');
    expect(currencySelect()).toHaveValue('USD');

    await person.selectOptions(screen.getByLabelText('Карта'), 'Миша');
    expect(currencySelect()).toHaveValue('AMD');
  });

  it('смена карты сбрасывает вручную выбранную валюту к валюте карты', async () => {
    const person = await renderForm();
    await person.selectOptions(currencySelect(), 'EUR');

    await person.selectOptions(screen.getByLabelText('Карта'), 'Доллары');

    expect(currencySelect()).toHaveValue('USD');
    expect(screen.queryByLabelText(/Курс/)).toBeNull();
  });

  it('карта в долларах: сумма в долларах с копейками уходит без валюты и курса', async () => {
    const person = await renderForm();
    await person.selectOptions(screen.getByLabelText('Карта'), 'Доллары');
    expect(screen.getByLabelText('Стоимость')).toHaveAttribute('inputmode', 'decimal');

    await fill(person, '10,5');
    await submit(person);

    await vi.waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]).toMatchObject({ card: 'Доллары', amount: 10.5 });
    expect(posted[0]).not.toHaveProperty('currency');
    expect(posted[0]).not.toHaveProperty('rate');
  });

  it('другая валюта на карте в долларах: курс обязателен, пересчёт идёт через драммы', async () => {
    const person = await renderForm();
    await person.selectOptions(screen.getByLabelText('Карта'), 'Доллары');
    await person.selectOptions(currencySelect(), 'EUR');

    expect(screen.getByLabelText('Курс: AMD за 1 EUR')).toHaveValue('500');
    await person.type(screen.getByLabelText('Стоимость'), '8');
    // 8 EUR * 500 / 400 = 10 USD
    expect(screen.getByText('≈ 10,00 USD')).toBeInTheDocument();

    await fill(person, '');
    await submit(person);
    await vi.waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]).toMatchObject({ amount: 8, currency: 'EUR', rate: 500 });
  });

  it('драммы на карте в долларах: целая сумма, курс не нужен, заметка в долларах', async () => {
    const person = await renderForm();
    await person.selectOptions(screen.getByLabelText('Карта'), 'Доллары');
    await person.selectOptions(currencySelect(), 'AMD');

    expect(screen.queryByLabelText(/Курс/)).toBeNull();
    await person.type(screen.getByLabelText('Стоимость'), '4000');
    expect(screen.getByText('≈ 10,00 USD')).toBeInTheDocument();

    await fill(person, '');
    await submit(person);
    await vi.waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]).toMatchObject({ amount: 4000, currency: 'AMD' });
    expect(posted[0]).not.toHaveProperty('rate');
  });

  it('проверка суммы: и в драммах, и в долларах до двух знаков после запятой', async () => {
    const person = await renderForm();
    // AMD card: the amount takes cents as well, only a positive amount is required
    await person.type(screen.getByLabelText('Стоимость'), '0');
    await submit(person);
    expect(await screen.findByText('Стоимость должна быть больше нуля')).toBeInTheDocument();

    await person.selectOptions(screen.getByLabelText('Карта'), 'Доллары');
    await person.clear(screen.getByLabelText('Стоимость'));
    await person.type(screen.getByLabelText('Стоимость'), '12,345');
    expect(screen.getByLabelText('Стоимость')).toHaveValue('12,34');

    await person.selectOptions(screen.getByLabelText('Карта'), 'Миша');
    await person.clear(screen.getByLabelText('Стоимость'));
    await person.type(screen.getByLabelText('Стоимость'), '7,505');
    expect(screen.getByLabelText('Стоимость')).toHaveValue('7,50');
  });

  it('в списке карт у каждой флаг, название и код валюты, в том числе когда все карты в драммах', async () => {
    cards = [
      { name: 'Миша', currency: 'AMD' },
      { name: 'Настя', currency: 'AMD' },
    ];
    await renderForm();

    const options = within(screen.getByLabelText('Карта')).getAllByRole('option');
    expect(options.map((option) => option.textContent)).toEqual([
      '🇦🇲 Миша · AMD',
      '🇦🇲 Настя · AMD',
    ]);
  });
});

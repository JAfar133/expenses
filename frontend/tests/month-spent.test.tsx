import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MonthSpent } from '../src/features/analytics/components/MonthSpent.tsx';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

let requests: string[];
let summaryResponse: () => Response;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 9, 15, 12, 0, 0));
  requests = [];
  summaryResponse = () =>
    json({ success: true, data: { current: { total: 123456 }, previous: null } });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      requests.push(url);
      return summaryResponse();
    }),
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function renderBlock() {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter>
        <MonthSpent currency="AMD" />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('MonthSpent', () => {
  it('показывает сумму за текущий месяц и ссылку на анализ', async () => {
    renderBlock();

    expect(await screen.findByText('123 456 AMD')).toBeInTheDocument();
    expect(screen.getByText(/В этом месяце потрачено/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Анализ' })).toHaveAttribute('href', '/analytics');
  });

  it('запрашивает границы текущего месяца', async () => {
    renderBlock();

    await screen.findByText('123 456 AMD');

    expect(requests).toEqual(['/api/analytics/summary?from=2026-10-01&to=2026-10-31']);
  });

  it('при ошибке ничего не показывает и не мешает форме', async () => {
    summaryResponse = () => json({ success: false, error: { code: 'X', message: 'x' } }, 500);
    renderBlock();

    await waitFor(() => expect(requests).toHaveLength(1));

    expect(screen.queryByText(/В этом месяце/)).toBeNull();
  });
});

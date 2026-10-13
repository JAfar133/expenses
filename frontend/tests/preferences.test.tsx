import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePreference } from '../src/features/preferences/hooks/usePreferences.ts';
import {
  defaultPreferences,
  isAllowed,
  PREFERENCE_KEYS,
  PREFERENCES,
  sanitizePreferences,
} from '../src/features/preferences/model/preferences.ts';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const ok = (data: unknown) => json({ success: true, data });

let server: Record<string, string>;
let puts: unknown[];
let failing: boolean;

beforeEach(() => {
  server = {};
  puts = [];
  failing = false;
  localStorage.clear();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url !== '/api/preferences') throw new Error(`Unexpected request: ${url}`);
      if (failing) return json({ success: false, error: { code: 'X', message: 'x' } }, 500);
      if (init?.method === 'PUT') {
        const patch = JSON.parse(String(init.body));
        puts.push(patch);
        server = { ...server, ...patch };
      }
      return ok(server);
    }),
  );
});

afterEach(() => vi.unstubAllGlobals());

/** Tiny component showing a setting's value and a button to change it. */
function Probe({ next = 'line' }: { next?: 'bars' | 'line' | 'area' }) {
  const [value, change] = usePreference('daily.type');
  return (
    <>
      <output aria-label="значение">{value}</output>
      <button type="button" onClick={() => change(next)}>
        сменить
      </button>
    </>
  );
}

const renderProbe = (props: { next?: 'bars' | 'line' | 'area' } = {}) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <Probe {...props} />
    </QueryClientProvider>,
  );
  return { user: userEvent.setup(), client };
};

const value = () => screen.getByLabelText('значение');

describe('описание настроек', () => {
  it('значение по умолчанию каждой настройки допустимо', () => {
    for (const key of PREFERENCE_KEYS) {
      expect(isAllowed(key, PREFERENCES[key].fallback), key).toBe(true);
    }
    expect(Object.keys(defaultPreferences())).toEqual(PREFERENCE_KEYS);
  });

  it('sanitizePreferences оставляет только известные ключи с допустимыми значениями', () => {
    expect(
      sanitizePreferences({
        'daily.type': 'line',
        'daily.mode': 'radar',
        'compare.months': '6',
        password: 'x',
        'category.type': 5,
      }),
    ).toEqual({ 'daily.type': 'line', 'compare.months': '6' });
    expect(sanitizePreferences(null)).toEqual({});
    expect(sanitizePreferences('строка')).toEqual({});
    expect(sanitizePreferences([])).toEqual({});
  });
});

describe('usePreference', () => {
  it('пока ничего не выбрано: значение по умолчанию', async () => {
    renderProbe();

    await waitFor(() => expect(value()).toHaveTextContent('bars'));
    expect(puts).toEqual([]);
  });

  it('значение с сервера важнее значения из браузера', async () => {
    server = { 'daily.type': 'area' };
    localStorage.setItem('analytics.daily.type', 'line');
    renderProbe();

    await waitFor(() => expect(value()).toHaveTextContent('area'));
  });

  it('до ответа сервера показывается значение из браузера', () => {
    localStorage.setItem('analytics.daily.type', 'line');
    renderProbe();

    expect(value()).toHaveTextContent('line');
  });

  it('выбор, сделанный только в браузере, один раз переносится на сервер', async () => {
    localStorage.setItem('analytics.daily.type', 'line');
    localStorage.setItem('analytics.category.type', 'donut');
    server = { 'category.type': 'pie' }; // already on the server: not overwritten
    renderProbe();

    await waitFor(() => expect(puts).toEqual([{ 'daily.type': 'line' }]));
    expect(server['category.type']).toBe('pie');
    expect(value()).toHaveTextContent('line');
  });

  it('если на сервере уже всё есть, переноса нет', async () => {
    server = { 'daily.type': 'line' };
    localStorage.setItem('analytics.daily.type', 'area');
    renderProbe();

    await waitFor(() => expect(value()).toHaveTextContent('line'));
    expect(puts).toEqual([]);
  });

  it('смена значения: сразу в интерфейсе и в браузере, затем на сервере', async () => {
    const { user } = renderProbe({ next: 'area' });
    await waitFor(() => expect(value()).toHaveTextContent('bars'));

    await user.click(screen.getByRole('button', { name: 'сменить' }));

    expect(value()).toHaveTextContent('area');
    expect(localStorage.getItem('analytics.daily.type')).toBe('area');
    await waitFor(() => expect(puts).toEqual([{ 'daily.type': 'area' }]));
  });

  it('сервер недоступен: значение из браузера, выбор не теряется и ничего не падает', async () => {
    failing = true;
    localStorage.setItem('analytics.daily.type', 'line');
    const { user } = renderProbe({ next: 'area' });
    expect(value()).toHaveTextContent('line');

    await user.click(screen.getByRole('button', { name: 'сменить' }));

    expect(value()).toHaveTextContent('area');
    expect(localStorage.getItem('analytics.daily.type')).toBe('area');
  });

  it('недопустимые значения из браузера и с сервера игнорируются', async () => {
    server = { 'daily.type': 'radar' } as never;
    localStorage.setItem('analytics.daily.type', 'hexagon');
    renderProbe();

    await waitFor(() => expect(value()).toHaveTextContent('bars'));
  });

  it('несколько компонентов с одной настройкой видят одно значение', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const user = userEvent.setup();
    render(
      <QueryClientProvider client={client}>
        <Probe next="line" />
        <Probe />
      </QueryClientProvider>,
    );

    await user.click(screen.getAllByRole('button', { name: 'сменить' })[0]!);

    expect(screen.getAllByLabelText('значение').map((node) => node.textContent)).toEqual([
      'line',
      'line',
    ]);
  });
});

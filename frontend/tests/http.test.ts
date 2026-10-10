import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiRequest } from '../src/shared/api/http.ts';

afterEach(() => vi.unstubAllGlobals());

function stubFetch() {
  const fetchMock = vi.fn(
    async () => new Response(JSON.stringify({ success: true, data: {} }), { status: 200 }),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const headersOf = (fetchMock: ReturnType<typeof stubFetch>) =>
  new Headers((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].headers);

describe('apiRequest', () => {
  it('запрос без тела отправляется без Content-Type (иначе сервер отвечает 400)', async () => {
    const fetchMock = stubFetch();

    await apiRequest('/sync', { method: 'POST' });

    expect(headersOf(fetchMock).has('content-type')).toBe(false);
  });

  it('запрос с телом отправляется как JSON', async () => {
    const fetchMock = stubFetch();

    await apiRequest('/expenses', { method: 'POST', body: '{"a":1}' });

    expect(headersOf(fetchMock).get('content-type')).toBe('application/json');
  });

  it('дополнительные заголовки сохраняются', async () => {
    const fetchMock = stubFetch();

    await apiRequest('/expenses', {
      method: 'POST',
      body: '{}',
      headers: { 'Idempotency-Key': 'k' },
    });

    expect(headersOf(fetchMock).get('idempotency-key')).toBe('k');
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiRequest, downloadFile, parseFileName } from '../src/shared/api/http.ts';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

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

describe('parseFileName', () => {
  it("предпочитает filename*=UTF-8'' и декодирует его", () => {
    const header =
      'attachment; filename="expenses-2026-10-12.xlsx"; filename*=UTF-8\'\'%D1%80%D0%B0%D1%81%D1%85%D0%BE%D0%B4%D1%8B-2026-10-12.xlsx';
    expect(parseFileName(header, 'x.xlsx')).toBe('расходы-2026-10-12.xlsx');
  });

  it('без звёздочки берёт filename="…"', () => {
    expect(parseFileName('attachment; filename="expenses-2026-10-12.xlsx"', 'x.xlsx')).toBe(
      'expenses-2026-10-12.xlsx',
    );
  });

  it('без заголовка или имени возвращает запасное', () => {
    expect(parseFileName(null, 'x.xlsx')).toBe('x.xlsx');
    expect(parseFileName('attachment', 'x.xlsx')).toBe('x.xlsx');
  });

  it('ломаная кодировка в звёздочной форме: берёт обычное имя', () => {
    expect(parseFileName('attachment; filename="a.xlsx"; filename*=UTF-8\'\'%E0%A4%A', 'x')).toBe(
      'a.xlsx',
    );
  });
});

describe('downloadFile', () => {
  const file = () =>
    new Response('xlsx', {
      status: 200,
      headers: { 'Content-Disposition': 'attachment; filename="r.xlsx"' },
    });
  let clicked: { download: string; href: string }[];

  function stubBrowser() {
    clicked = [];
    URL.createObjectURL = vi.fn(() => 'blob:report');
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicked.push({ download: this.download, href: this.href });
    });
  }

  it('скачивает файл: ссылка с именем из заголовка, адрес освобождается', async () => {
    stubBrowser();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => file()),
    );

    await downloadFile('/expenses/export.xlsx?from=2026-10-01', 'fallback.xlsx');

    expect(clicked).toEqual([{ download: 'r.xlsx', href: 'blob:report' }]);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:report');
    expect(document.querySelector('a[download]')).toBeNull();
  });

  it('ошибка сервера в JSON становится ApiError, файл не сохраняется', async () => {
    stubBrowser();
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              success: false,
              error: { code: 'EXPORT_TOO_LARGE', message: 'Слишком много' },
            }),
            { status: 422 },
          ),
      ),
    );

    await expect(downloadFile('/expenses/export.xlsx', 'f.xlsx')).rejects.toMatchObject({
      status: 422,
      code: 'EXPORT_TOO_LARGE',
      message: 'Слишком много',
    });
    expect(clicked).toEqual([]);
  });

  it('на 401 обновляет сессию и повторяет запрос один раз', async () => {
    stubBrowser();
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        calls.push(url);
        if (url === '/api/auth/refresh')
          return new Response(JSON.stringify({ success: true, data: {} }));
        if (calls.filter((c) => c.includes('export')).length === 1)
          return new Response(
            JSON.stringify({ success: false, error: { code: 'UNAUTHORIZED', message: 'x' } }),
            { status: 401 },
          );
        return file();
      }),
    );

    await downloadFile('/expenses/export.xlsx', 'f.xlsx');

    expect(calls).toEqual([
      '/api/expenses/export.xlsx',
      '/api/auth/refresh',
      '/api/expenses/export.xlsx',
    ]);
    expect(clicked).toHaveLength(1);
  });

  it('сетевая ошибка — ApiError без соединения', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(new TypeError('x'))),
    );

    await expect(downloadFile('/x', 'f')).rejects.toBeInstanceOf(ApiError);
  });
});

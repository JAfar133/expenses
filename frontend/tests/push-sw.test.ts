import SOURCE from '../public/sw.js?raw';
import { describe, expect, it, vi } from 'vitest';

type Handler = (event: Record<string, unknown>) => void;

/** Runs sw.js in a context with a fake service worker scope. */
function load(overrides: Record<string, unknown> = {}) {
  const handlers = new Map<string, Handler>();
  const showNotification = vi.fn(async (_title: string, _options?: unknown) => undefined);
  const setAppBadge = vi.fn(async (_count?: number) => undefined);
  const clearAppBadge = vi.fn(async () => undefined);
  const windows: Record<string, ReturnType<typeof vi.fn>>[] = [];
  const clients = {
    matchAll: vi.fn(async (_options?: unknown) => windows),
    openWindow: vi.fn(async (_url?: string) => undefined),
  };
  const subscribe = vi.fn(async (_options?: unknown) => ({
    toJSON: () => ({ endpoint: 'https://push.example/new', keys: { p256dh: 'p', auth: 'a' } }),
  }));
  const fetchMock = vi.fn(async (_url: string, _init?: unknown) => ({
    json: async () => ({ data: { publicKey: 'AQAB' } }),
  }));
  const self = {
    addEventListener: (type: string, handler: Handler) => handlers.set(type, handler),
    registration: { showNotification, pushManager: { subscribe } },
    navigator: { setAppBadge, clearAppBadge },
    clients,
    ...overrides,
  };
  // The file runs with its own `self` (the scope of a service worker), `fetch` and `atob`, nothing else of the page
  new Function('self', 'fetch', 'atob', SOURCE)(self, fetchMock, globalThis.atob);
  /** Fires an event and waits for what it handed to waitUntil. */
  const fire = async (type: string, event: Record<string, unknown>) => {
    let work: Promise<unknown> = Promise.resolve();
    handlers.get(type)!({ ...event, waitUntil: (promise: Promise<unknown>) => (work = promise) });
    await work;
  };
  return {
    fire,
    showNotification,
    setAppBadge,
    clearAppBadge,
    clients,
    windows,
    subscribe,
    fetchMock,
    handlers,
  };
}

const pushEvent = (payload: unknown) => ({ data: { json: () => payload } });

describe('sw.js', () => {
  it('не перехватывает запросы: обработчика fetch нет', () => {
    const { handlers } = load();
    expect([...handlers.keys()].sort()).toEqual([
      'notificationclick',
      'push',
      'pushsubscriptionchange',
    ]);
    expect(SOURCE).not.toMatch(/caches\./);
  });

  it('push: всегда показывает уведомление с заголовком, текстом, tag, данными, иконкой и временем', async () => {
    const { fire, showNotification } = load();

    await fire(
      'push',
      pushEvent({
        id: 'n1',
        title: 'Расход добавлен',
        body: '1 540 AMD',
        url: '/analytics/operations',
        unread: 3,
        ts: 1700000000000,
      }),
    );

    expect(showNotification).toHaveBeenCalledWith('Расход добавлен', {
      body: '1 540 AMD',
      tag: 'n1',
      data: { url: '/analytics/operations', id: 'n1' },
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      timestamp: 1700000000000,
    });
  });

  it('push с поломанным JSON всё равно показывает уведомление «Расходы»', async () => {
    const { fire, showNotification } = load();

    await fire('push', {
      data: {
        json: () => {
          throw new Error('bad');
        },
      },
    });
    await fire('push', {});

    expect(showNotification).toHaveBeenCalledTimes(2);
    expect(showNotification.mock.calls[0]![0]).toBe('Расходы');
    expect(showNotification.mock.calls[1]![0]).toBe('Расходы');
  });

  it('значок на иконке: число при непрочитанных, сброс при нуле; его ошибка не прячет уведомление', async () => {
    const first = load();
    await first.fire('push', pushEvent({ id: 'a', title: 'T', unread: 4 }));
    expect(first.setAppBadge).toHaveBeenCalledWith(4);

    const second = load();
    await second.fire('push', pushEvent({ id: 'b', title: 'T', unread: 0 }));
    expect(second.clearAppBadge).toHaveBeenCalled();

    const broken = load({
      navigator: {
        setAppBadge: async () => {
          throw new Error('no');
        },
      },
    });
    await broken.fire('push', pushEvent({ id: 'c', title: 'T', unread: 2 }));
    expect(broken.showNotification).toHaveBeenCalled();
  });

  it('нажатие: закрывает уведомление и открывает окно, если приложение не открыто', async () => {
    const { fire, clients } = load();
    const close = vi.fn();

    await fire('notificationclick', { notification: { close, data: { url: '/group' } } });

    expect(close).toHaveBeenCalled();
    expect(clients.openWindow).toHaveBeenCalledWith('/group');
  });

  it('нажатие: открытое окно переходит по адресу и получает фокус', async () => {
    const { fire, clients, windows } = load();
    const win = {
      navigate: vi.fn(async () => undefined),
      focus: vi.fn(async () => undefined),
      postMessage: vi.fn(),
    };
    windows.push(win as never);

    await fire('notificationclick', {
      notification: { close: vi.fn(), data: { url: '/analytics/operations' } },
    });

    expect(clients.matchAll).toHaveBeenCalledWith({ type: 'window', includeUncontrolled: true });
    expect(win.navigate).toHaveBeenCalledWith('/analytics/operations');
    expect(win.focus).toHaveBeenCalled();
    expect(clients.openWindow).not.toHaveBeenCalled();
  });

  it('нажатие: если окно не умеет navigate, ему шлют сообщение и всё равно фокусируют', async () => {
    const { fire, windows } = load();
    const win = {
      navigate: vi.fn(async () => {
        throw new Error('no');
      }),
      focus: vi.fn(async () => undefined),
      postMessage: vi.fn(),
    };
    windows.push(win as never);

    await fire('notificationclick', { notification: { close: vi.fn(), data: { url: '/group' } } });

    expect(win.postMessage).toHaveBeenCalledWith({ type: 'navigate', url: '/group' });
    expect(win.focus).toHaveBeenCalled();
  });

  it('нажатие: чужой или опасный адрес заменяется стартовой страницей', async () => {
    for (const url of [
      'https://evil.example/x',
      '//evil.example',
      'javascript:alert(1)',
      undefined,
    ]) {
      const { fire, clients } = load();
      await fire('notificationclick', { notification: { close: vi.fn(), data: { url } } });
      expect(clients.openWindow).toHaveBeenCalledWith('/');
    }
  });

  it('pushsubscriptionchange: подписывается заново ключом старой подписки и шлёт новую на сервер', async () => {
    const { fire, subscribe, fetchMock } = load();
    const key = new Uint8Array([1, 2, 3]);

    await fire('pushsubscriptionchange', {
      oldSubscription: { options: { applicationServerKey: key } },
    });

    expect(subscribe).toHaveBeenCalledWith({ userVisibleOnly: true, applicationServerKey: key });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/push/subscriptions',
      expect.objectContaining({ method: 'POST', credentials: 'include' }),
    );
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as { body: string }).body);
    expect(body).toEqual({
      endpoint: 'https://push.example/new',
      keys: { p256dh: 'p', auth: 'a' },
    });
  });

  it('pushsubscriptionchange: без старого ключа берёт ключ сервера; ошибки не падают наружу', async () => {
    const { fire, subscribe, fetchMock } = load();
    await fire('pushsubscriptionchange', {});
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/push/config');
    expect(subscribe).toHaveBeenCalled();

    const failing = load();
    failing.subscribe.mockRejectedValue(new Error('no'));
    await expect(failing.fire('pushsubscriptionchange', {})).resolves.toBeUndefined();
  });
});

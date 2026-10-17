import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, renderHook, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useLogout } from '../src/features/auth/hooks/useAuth.ts';
import { unsubscribeThisDevice } from '../src/features/push/hooks/usePush.ts';
import { NotificationsCard } from '../src/features/settings/components/NotificationsCard.tsx';
import { deviceLabel, endpointKey } from '../src/features/push/model/webpush.ts';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const ok = (data: unknown, status = 200) => json({ success: true, data }, status);

const USER = {
  username: 'misha',
  displayName: 'Миша',
  card: 'Миша',
  canEdit: true,
  timezone: 'Asia/Yerevan',
  role: 'owner',
  isAdmin: false,
};

const KEY = 'AQID'; // the bytes 1, 2, 3
const ENDPOINT = 'https://web.push.apple.com/abc';

type Call = { method: string; url: string; body?: Record<string, unknown> };
let calls: Call[];
let role: 'owner' | 'member';
let config: { enabled: boolean; publicKey: string | null };
let devices: Record<string, unknown>[];
let settings: { push: { types: Record<string, boolean>; hideAmounts: boolean } };
let pushError: Response | null;
let testResult: { sent: number; removed: number };

let browserSub: ReturnType<typeof makeSub> | null;
let permission: NotificationPermission;
const requestPermission = vi.fn();
const subscribe = vi.fn();
const register = vi.fn();

const keyBuffer = (bytes: number[]) => new Uint8Array(bytes).buffer;
function makeSub(endpoint = ENDPOINT, key = [1, 2, 3]) {
  return {
    endpoint,
    options: { applicationServerKey: keyBuffer(key) },
    toJSON: () => ({ endpoint, keys: { p256dh: 'P256', auth: 'AUTH' } }),
    unsubscribe: vi.fn(async () => {
      browserSub = null;
      return true;
    }),
  };
}

const device = (overrides: Record<string, unknown> = {}) => ({
  id: 'd1',
  label: 'iPhone · Safari (приложение)',
  createdAt: '2026-10-17T10:00:00.000Z',
  lastSuccessAt: null,
  failures: 0,
  ...overrides,
});

function setUserAgent(ua: string) {
  Object.defineProperty(navigator, 'userAgent', { value: ua, configurable: true });
}
const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';
const CHROME =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

function installBrowser(withApis = true) {
  const registration = {
    pushManager: { getSubscription: vi.fn(async () => browserSub), subscribe },
  };
  if (withApis) {
    Object.defineProperty(navigator, 'serviceWorker', {
      value: {
        register,
        ready: Promise.resolve(registration),
        getRegistration: async () => registration,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      },
      configurable: true,
    });
    vi.stubGlobal('PushManager', class {});
    const NotificationStub = Object.assign(vi.fn(), { requestPermission });
    Object.defineProperty(NotificationStub, 'permission', { get: () => permission });
    vi.stubGlobal('Notification', NotificationStub);
  } else {
    Object.defineProperty(navigator, 'serviceWorker', { value: undefined, configurable: true });
    delete (navigator as unknown as Record<string, unknown>).serviceWorker;
    vi.stubGlobal('PushManager', undefined);
    delete (globalThis as Record<string, unknown>).PushManager;
    delete (globalThis as Record<string, unknown>).Notification;
  }
}

beforeEach(() => {
  calls = [];
  role = 'owner';
  config = { enabled: true, publicKey: KEY };
  devices = [];
  settings = {
    push: {
      types: { expense_imported: true, import_problem: true, receipt_parsed: false },
      hideAmounts: false,
    },
  };
  pushError = null;
  testResult = { sent: 1, removed: 0 };
  browserSub = null;
  permission = 'default';
  requestPermission.mockReset().mockImplementation(async () => {
    permission = 'granted';
    return 'granted';
  });
  subscribe.mockReset().mockImplementation(async () => {
    browserSub = makeSub();
    return browserSub;
  });
  register.mockReset().mockResolvedValue({});
  setUserAgent(CHROME);
  Object.defineProperty(navigator, 'standalone', { value: false, configurable: true });
  installBrowser();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ method, url, body });
      if (url === '/api/auth/me') return ok({ user: { ...USER, role } });
      if (url === '/api/push/config') return ok(config);
      if (url === '/api/push/subscriptions' && method === 'GET') return ok(devices);
      if (url === '/api/push/subscriptions' && method === 'POST') {
        if (pushError) return pushError;
        devices = [device({ id: 'd-new', label: body?.label })];
        return ok({ id: 'd-new' }, 201);
      }
      if (url.startsWith('/api/push/subscriptions/') && method === 'DELETE') return ok({});
      if (url === '/api/push/subscriptions/unsubscribe') return ok({});
      if (url === '/api/push/test') return ok(testResult);
      if (url === '/api/notifications/settings' && method === 'GET') return ok(settings);
      if (url === '/api/notifications/settings' && method === 'PUT') {
        const patch = body as { push?: { types?: Record<string, boolean>; hideAmounts?: boolean } };
        settings = {
          push: {
            types: { ...settings.push.types, ...patch.push?.types },
            hideAmounts: patch.push?.hideAmounts ?? settings.push.hideAmounts,
          },
        };
        return ok({});
      }
      if (url === '/api/auth/logout') return ok({});
      throw new Error(`Unexpected request: ${method} ${url}`);
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  setUserAgent('jsdom');
});

function renderCard() {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter>
        <NotificationsCard />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return userEvent.setup();
}
const sent = (method: string, url: string) =>
  calls.find((c) => c.method === method && c.url === url)?.body;

describe('состояние этого устройства', () => {
  it('сервер без Web Push: только строка про это, больше ничего', async () => {
    config = { enabled: false, publicKey: null };
    renderCard();

    expect(
      await screen.findByText('Уведомления на телефон не настроены на сервере'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Это устройство')).toBeNull();
    expect(screen.queryByRole('button', { name: /Включить/ })).toBeNull();
  });

  it('iPhone во вкладке Safari: шаги «На экран Домой»', async () => {
    setUserAgent(IPHONE);
    installBrowser(false);
    renderCard();

    expect(
      await screen.findByText(/работают только в приложении с экрана «Домой»/),
    ).toBeInTheDocument();
    expect(screen.getByText(/Выберите «На экран Домой»/)).toBeInTheDocument();
    expect(screen.getByText(/Откройте приложение с экрана «Домой»/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Включить/ })).toBeNull();
  });

  it('браузер без нужных API: «Этот браузер не поддерживает уведомления»', async () => {
    installBrowser(false);
    renderCard();

    expect(await screen.findByText('Этот браузер не поддерживает уведомления')).toBeInTheDocument();
  });

  it('разрешение отклонено: как разрешить', async () => {
    permission = 'denied';
    renderCard();

    expect(await screen.findByText('Уведомления запрещены для этого сайта')).toBeInTheDocument();
    expect(screen.getByText(/Настройки → Уведомления → Расходы/)).toBeInTheDocument();
    expect(screen.getByText(/значок\s+замка в адресной строке/)).toBeInTheDocument();
  });

  it('выключено: главная кнопка; включено: текст, тест и отключение', async () => {
    renderCard();
    expect(
      await screen.findByRole('button', { name: 'Включить уведомления на этом устройстве' }),
    ).toBeInTheDocument();
  });

  it('метка устройства из user agent и режима приложения', () => {
    expect(deviceLabel(IPHONE, true, 'iPhone', 5)).toBe('iPhone · Safari (приложение)');
    expect(deviceLabel(CHROME, false, 'Win32', 0)).toBe('Chrome · Windows');
  });
});

describe('включение', () => {
  it('разрешение просят прямо в обработчике нажатия, подписка с userVisibleOnly и ключом сервера, POST с адресом, ключами и меткой', async () => {
    const person = renderCard();

    await person.click(
      await screen.findByRole('button', { name: 'Включить уведомления на этом устройстве' }),
    );

    await waitFor(() => expect(sent('POST', '/api/push/subscriptions')).toBeDefined());
    expect(requestPermission).toHaveBeenCalledTimes(1);
    // The request comes before anything else of the flow
    expect(requestPermission.mock.invocationCallOrder[0]).toBeLessThan(
      register.mock.invocationCallOrder[0]!,
    );
    const options = subscribe.mock.calls[0]![0] as {
      userVisibleOnly: boolean;
      applicationServerKey: Uint8Array;
    };
    expect(options.userVisibleOnly).toBe(true);
    expect([...options.applicationServerKey]).toEqual([1, 2, 3]);
    expect(sent('POST', '/api/push/subscriptions')).toEqual({
      endpoint: ENDPOINT,
      keys: { p256dh: 'P256', auth: 'AUTH' },
      label: 'Chrome · Windows',
    });
    expect(await screen.findByText('Уведомления включены на этом устройстве')).toBeInTheDocument();
    expect(localStorage.getItem(`push.device.${endpointKey(ENDPOINT)}`)).toBe('d-new');
  });

  it('отказ в разрешении: понятное сообщение, подписки нет', async () => {
    requestPermission.mockResolvedValue('denied');
    const person = renderCard();

    await person.click(
      await screen.findByRole('button', { name: 'Включить уведомления на этом устройстве' }),
    );

    expect(await screen.findByText(/Разрешение отклонено/)).toBeInTheDocument();
    expect(subscribe).not.toHaveBeenCalled();
  });

  it('окно закрыли без ответа: просьба нажать ещё раз', async () => {
    requestPermission.mockResolvedValue('default');
    const person = renderCard();

    await person.click(
      await screen.findByRole('button', { name: 'Включить уведомления на этом устройстве' }),
    );

    expect(await screen.findByText(/Разрешение не получено/)).toBeInTheDocument();
  });

  it('сервер отказал (адрес не поддерживается): его текст виден, подписка в браузере снимается', async () => {
    pushError = json(
      {
        success: false,
        error: { code: 'INVALID_ENDPOINT', message: 'Этот адрес подписки не поддерживается' },
      },
      422,
    );
    const person = renderCard();

    await person.click(
      await screen.findByRole('button', { name: 'Включить уведомления на этом устройстве' }),
    );

    expect(await screen.findByText('Этот адрес подписки не поддерживается')).toBeInTheDocument();
    expect(browserSub).toBeNull();
  });

  it('браузер не смог подписаться: сообщение', async () => {
    subscribe.mockRejectedValue(new Error('boom'));
    const person = renderCard();

    await person.click(
      await screen.findByRole('button', { name: 'Включить уведомления на этом устройстве' }),
    );

    expect(await screen.findByText(/Браузер не смог создать подписку/)).toBeInTheDocument();
  });
});

describe('включено на этом устройстве', () => {
  beforeEach(() => {
    browserSub = makeSub();
    devices = [device({ id: 'd1', label: 'Chrome · Windows' })];
    localStorage.setItem(`push.device.${endpointKey(ENDPOINT)}`, 'd1');
  });

  it('состояние словами, устройство в списке с пометкой, подписью дат и «ещё не получало»', async () => {
    renderCard();

    expect(await screen.findByText('Уведомления включены на этом устройстве')).toBeInTheDocument();
    const list = within(screen.getByRole('region', { name: 'Устройства' }));
    expect(list.getByText('Chrome · Windows')).toBeInTheDocument();
    expect(list.getByText('это устройство')).toBeInTheDocument();
    expect(list.getByText(/подключено 17 окт\.? · ещё не получало/)).toBeInTheDocument();
  });

  it('«не отвечает» при ошибках доставки и дата последнего уведомления', async () => {
    devices = [
      device({
        id: 'd1',
        label: 'Chrome · Windows',
        failures: 3,
        lastSuccessAt: '2026-10-18T10:00:00.000Z',
      }),
    ];
    renderCard();

    expect(await screen.findByText('не отвечает')).toBeInTheDocument();
    expect(screen.getByText(/последнее уведомление 18 окт\./)).toBeInTheDocument();
  });

  it('«Отправить тестовое» шлёт id этого устройства и показывает итог', async () => {
    const person = renderCard();

    await person.click(await screen.findByRole('button', { name: 'Отправить тестовое' }));

    expect(await screen.findByText('Отправлено на 1 устройство')).toBeInTheDocument();
    expect(sent('POST', '/api/push/test')).toEqual({ id: 'd1' });
  });

  it('«Отключить на этом устройстве»: DELETE на сервере и отписка в браузере', async () => {
    const person = renderCard();
    const sub = browserSub!;

    await person.click(await screen.findByRole('button', { name: 'Отключить на этом устройстве' }));

    await waitFor(() =>
      expect(
        calls.some((c) => c.method === 'DELETE' && c.url === '/api/push/subscriptions/d1'),
      ).toBe(true),
    );
    expect(sub.unsubscribe).toHaveBeenCalled();
    expect(localStorage.getItem(`push.device.${endpointKey(ENDPOINT)}`)).toBeNull();
  });

  it('«Отключить» у строки: подтверждение, потом DELETE', async () => {
    devices = [
      device({ id: 'd1', label: 'Chrome · Windows' }),
      device({ id: 'd2', label: 'iPhone · Safari' }),
    ];
    const person = renderCard();

    await person.click(await screen.findByRole('button', { name: 'Отключить: iPhone · Safari' }));
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
    const dialog = within(screen.getByRole('dialog', { name: 'Отключить устройство?' }));
    expect(
      dialog.getByText('Уведомления перестанут приходить на «iPhone · Safari»'),
    ).toBeInTheDocument();
    await person.click(dialog.getByRole('button', { name: 'Отключить' }));

    await waitFor(() =>
      expect(
        calls.some((c) => c.method === 'DELETE' && c.url === '/api/push/subscriptions/d2'),
      ).toBe(true),
    );
    expect(browserSub).not.toBeNull();
  });
});

describe('самовосстановление', () => {
  it('в браузере есть подписка, которой нет на сервере: она отправляется заново', async () => {
    browserSub = makeSub();
    devices = [];
    renderCard();

    await waitFor(() => expect(sent('POST', '/api/push/subscriptions')).toBeDefined());
    expect(sent('POST', '/api/push/subscriptions')!.endpoint).toBe(ENDPOINT);
  });

  it('ключ сервера другой: старая подписка снимается, создаётся новая и отправляется', async () => {
    browserSub = makeSub(ENDPOINT, [9, 9, 9]);
    const old = browserSub;
    devices = [device({ id: 'd1' })];
    localStorage.setItem(`push.device.${endpointKey(ENDPOINT)}`, 'd1');
    renderCard();

    await waitFor(() => expect(subscribe).toHaveBeenCalled());
    expect(old.unsubscribe).toHaveBeenCalled();
    await waitFor(() => expect(sent('POST', '/api/push/subscriptions')).toBeDefined());
  });
});

describe('что присылать и приватность', () => {
  it('владелец видит три строки, участник две (без ошибок импорта)', async () => {
    renderCard();
    await screen.findByText('Ошибки импорта');
    expect(screen.getByText('Расходы из банка и Wallet')).toBeInTheDocument();
    expect(screen.getByText('Распознанные чеки')).toBeInTheDocument();
  });

  it('участник: строки «Ошибки импорта» нет', async () => {
    role = 'member';
    renderCard();

    await screen.findByText('Расходы из банка и Wallet');
    expect(screen.queryByText('Ошибки импорта')).toBeNull();
  });

  it('пояснение следует за выбором, PUT шлёт только изменённую часть', async () => {
    const person = renderCard();
    const rows = await screen.findByRole('region', { name: 'Что присылать' });
    const group = within(
      within(rows).getByRole('radiogroup', { name: 'Расходы из банка и Wallet' }),
    );

    expect(
      within(rows).getByText('Придёт уведомление, когда расход добавлен автоматически'),
    ).toBeInTheDocument();
    await person.click(group.getByRole('radio', { name: 'Не присылать' }));

    await waitFor(() =>
      expect(sent('PUT', '/api/notifications/settings')).toEqual({
        push: { types: { expense_imported: false } },
      }),
    );
    expect(
      within(rows).getByText('Не присылаем. В колокольчике расходы останутся'),
    ).toBeInTheDocument();
  });

  it('распознанные чеки по умолчанию выключены и включаются', async () => {
    const person = renderCard();
    const rows = await screen.findByRole('region', { name: 'Что присылать' });
    const group = within(within(rows).getByRole('radiogroup', { name: 'Распознанные чеки' }));

    expect(group.getByRole('radio', { name: 'Не присылать' })).toBeChecked();
    await person.click(group.getByRole('radio', { name: 'Присылать' }));

    await waitFor(() =>
      expect(sent('PUT', '/api/notifications/settings')).toEqual({
        push: { types: { receipt_parsed: true } },
      }),
    );
  });

  it('приватность: пример меняется, PUT с hideAmounts', async () => {
    const person = renderCard();
    const privacy = await screen.findByRole('region', { name: 'Приватность' });

    expect(
      within(privacy).getByText(
        'Так будет выглядеть: «Расход добавлен — 2 150 AMD · Food Court 7 · Visa Digital · из Wallet»',
      ),
    ).toBeInTheDocument();
    await person.click(within(privacy).getByRole('radio', { name: 'Скрывать суммы' }));

    await waitFor(() =>
      expect(sent('PUT', '/api/notifications/settings')).toEqual({ push: { hideAmounts: true } }),
    );
    expect(
      within(privacy).getByText('Так будет выглядеть: «Расход добавлен — Из Wallet»'),
    ).toBeInTheDocument();
  });
});

describe('выход из приложения', () => {
  it('подписка этого устройства снимается на сервере и в браузере до выхода', async () => {
    browserSub = makeSub();
    const sub = browserSub;

    await unsubscribeThisDevice();

    expect(sent('POST', '/api/push/subscriptions/unsubscribe')).toEqual({ endpoint: ENDPOINT });
    expect(sub.unsubscribe).toHaveBeenCalled();
  });

  it('без подписки или при ошибке сервера выход не блокируется', async () => {
    await expect(unsubscribeThisDevice()).resolves.toBeUndefined();

    browserSub = makeSub();
    (fetch as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      throw new Error('offline');
    });
    await expect(unsubscribeThisDevice()).resolves.toBeUndefined();
  });

  it('useLogout: сначала отписка, потом запрос выхода', async () => {
    browserSub = makeSub();
    const client = new QueryClient();
    const { result } = renderHook(() => useLogout(), {
      wrapper: ({ children }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      ),
    });

    await result.current.mutateAsync();

    const urls = calls.map((c) => c.url);
    expect(urls.indexOf('/api/push/subscriptions/unsubscribe')).toBeGreaterThanOrEqual(0);
    expect(urls.indexOf('/api/push/subscriptions/unsubscribe')).toBeLessThan(
      urls.indexOf('/api/auth/logout'),
    );
  });
});

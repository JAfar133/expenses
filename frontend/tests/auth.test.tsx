import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/app/App.tsx';
import { ApiError, apiRequest, onSessionLost } from '../src/shared/api/http.ts';

const MISHA = {
  username: 'misha',
  displayName: 'Миша',
  card: 'Миша',
  canEdit: true,
  role: 'member',
  isAdmin: false,
  timezone: 'Asia/Yerevan',
};
const NASTYA = {
  username: 'nastya',
  displayName: 'Настя',
  card: 'Настя',
  canEdit: false,
  role: 'member',
  isAdmin: false,
  timezone: 'Asia/Yerevan',
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const ok = (data: unknown) => json(200, { success: true, data });
const fail = (status: number, code: string, message: string) =>
  json(status, { success: false, error: { code, message } });

type Access = 'valid' | 'expired';
type LoginBehavior = 'ok' | 'invalid' | 'throttled' | 'network' | 'server-error';

/** Fake server: remembers whether the login is valid and records all requests. */
function installFakeServer(
  initial: {
    access?: Access;
    refreshWorks?: boolean;
    user?: typeof MISHA;
    loginBehavior?: LoginBehavior;
  } = {},
) {
  const server = {
    access: initial.access ?? 'expired',
    refreshWorks: initial.refreshWorks ?? false,
    loginBehavior: initial.loginBehavior ?? 'ok',
    user: initial.user ?? MISHA,
    refreshDelay: 0,
    calls: [] as string[],
    count: (call: string) => server.calls.filter((c) => c === call).length,
  };
  const unauthenticated = () => fail(401, 'UNAUTHENTICATED', 'Требуется вход');

  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const call = `${init?.method ?? 'GET'} ${url.replace('/api', '')}`;
      server.calls.push(call);

      switch (call) {
        case 'POST /auth/login':
          if (server.loginBehavior === 'network') throw new TypeError('Failed to fetch');
          if (server.loginBehavior === 'invalid')
            return fail(401, 'INVALID_CREDENTIALS', 'Неверный логин или пароль');
          if (server.loginBehavior === 'throttled') {
            return fail(
              429,
              'TOO_MANY_ATTEMPTS',
              'Слишком много попыток входа. Повторите через 15 мин.',
            );
          }
          if (server.loginBehavior === 'server-error') return fail(500, 'INTERNAL_ERROR', 'boom');
          server.access = 'valid';
          return ok({ user: server.user });
        case 'POST /auth/refresh':
          if (server.refreshDelay)
            await new Promise((resolve) => setTimeout(resolve, server.refreshDelay));
          if (!server.refreshWorks) return unauthenticated();
          server.access = 'valid';
          return ok({ user: server.user, refreshed: true });
        case 'POST /auth/logout':
          server.access = 'expired';
          server.refreshWorks = false;
          return ok({});
        case 'GET /auth/me':
          return server.access === 'valid' ? ok({ user: server.user }) : unauthenticated();
      }

      if (server.access !== 'valid') return unauthenticated();
      if (call === 'GET /cards')
        return ok([
          { name: 'Миша', currency: 'AMD' },
          { name: 'Настя', currency: 'AMD' },
        ]);
      if (call === 'GET /categories') return ok(['кафе', 'продукты']);
      if (call === 'GET /config') return ok({ currency: 'AMD', baseCurrency: 'AMD' });
      if (call === 'GET /sync/status') {
        return ok({
          enabled: true,
          queued: 0,
          running: false,
          intervalMs: 300000,
          nextRunAt: null,
          serverTime: new Date().toISOString(),
        });
      }
      throw new Error(`Unexpected request: ${call}`);
    }),
  );
  return server;
}

beforeEach(() => localStorage.clear());
afterEach(() => {
  vi.unstubAllGlobals();
  onSessionLost(undefined);
});

describe('вход при открытии приложения', () => {
  it('если не вошли и обновить нечем, показывается форма входа', async () => {
    const server = installFakeServer({ access: 'expired', refreshWorks: false });
    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Вход' })).toBeInTheDocument();
    expect(screen.queryByText('Добавить расход')).not.toBeInTheDocument();
    // First try to silently restore the session using the refresh token
    expect(server.calls.slice(0, 2)).toEqual(['GET /auth/me', 'POST /auth/refresh']);
  });

  it('если access-кука истекла, а refresh действует, пользователь входит без пароля', async () => {
    const server = installFakeServer({ access: 'expired', refreshWorks: true });
    render(<App />);

    expect(await screen.findByText('Вы вошли как', { exact: false })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Вход' })).not.toBeInTheDocument();
    expect(server.calls.slice(0, 3)).toEqual([
      'GET /auth/me',
      'POST /auth/refresh',
      'GET /auth/me',
    ]);
  });

  it('если вход действует, форма расхода открывается сразу и без обновления токена', async () => {
    const server = installFakeServer({ access: 'valid' });
    render(<App />);

    expect(await screen.findByRole('button', { name: 'Добавить расход' })).toBeInTheDocument();
    expect(server.count('POST /auth/refresh')).toBe(0);
  });

  it('при недоступном сервере предлагает повторить, а не показывает форму входа', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    render(<App />);

    expect(await screen.findByRole('button', { name: 'Повторить' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Вход' })).not.toBeInTheDocument();
  });
});

describe('карта по умолчанию у вошедшего пользователя', () => {
  it('Миша: карта «Миша»', async () => {
    installFakeServer({ access: 'valid', user: MISHA });
    render(<App />);

    await screen.findByRole('button', { name: 'Добавить расход' });
    expect(screen.getByRole('radio', { name: /Миша/ })).toBeChecked();
    expect(screen.getByText('Миша', { selector: 'strong' })).toBeInTheDocument();
  });

  it('Настя: карта «Настя»', async () => {
    installFakeServer({ access: 'valid', user: NASTYA });
    render(<App />);

    await screen.findByRole('button', { name: 'Добавить расход' });
    expect(screen.getByRole('radio', { name: /Настя/ })).toBeChecked();
  });
});

describe('форма входа', () => {
  async function openLogin(behavior: LoginBehavior = 'ok', user = MISHA) {
    const server = installFakeServer({
      access: 'expired',
      refreshWorks: false,
      loginBehavior: behavior,
      user,
    });
    const person = userEvent.setup();
    render(<App />);
    await screen.findByRole('heading', { name: 'Вход' });
    server.calls.length = 0;
    return { server, person };
  }

  const fillAndSubmit = async (
    person: ReturnType<typeof userEvent.setup>,
    username = 'misha',
    password = 'secret-password-1',
  ) => {
    await person.type(screen.getByLabelText('Логин'), username);
    await person.type(screen.getByLabelText('Пароль'), password);
    await person.click(screen.getByRole('button', { name: 'Войти' }));
  };

  it('поля подготовлены для менеджеров паролей и мобильных клавиатур', async () => {
    await openLogin();

    expect(screen.getByLabelText('Логин')).toHaveAttribute('autocomplete', 'username');
    expect(screen.getByLabelText('Логин')).toHaveAttribute('autocapitalize', 'none');
    expect(screen.getByLabelText('Пароль')).toHaveAttribute('autocomplete', 'current-password');
    expect(screen.getByLabelText('Пароль')).toHaveAttribute('type', 'password');
  });

  it('верные данные: открывается приложение с картой пользователя', async () => {
    const { person } = await openLogin('ok', NASTYA);

    await fillAndSubmit(person, 'nastya');

    expect(await screen.findByRole('button', { name: 'Добавить расход' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Настя/ })).toBeChecked();
  });

  it('на сервер уходит логин без пробелов и пароль как есть', async () => {
    const { person } = await openLogin();

    await fillAndSubmit(person, '  misha  ', ' пароль с пробелами ');

    await screen.findByRole('button', { name: 'Добавить расход' });
    const login = vi.mocked(fetch).mock.calls.find(([url]) => url === '/api/auth/login')!;
    expect(JSON.parse(String(login[1]?.body))).toEqual({
      username: 'misha',
      password: ' пароль с пробелами ',
    });
  });

  it('пустые поля не отправляются и подсвечиваются', async () => {
    const { server, person } = await openLogin();

    await person.click(screen.getByRole('button', { name: 'Войти' }));

    expect(await screen.findByText('Введите логин')).toBeInTheDocument();
    expect(screen.getByText('Введите пароль')).toBeInTheDocument();
    expect(server.count('POST /auth/login')).toBe(0);
  });

  it('неверный пароль: сообщение сервера, форма остаётся', async () => {
    const { person } = await openLogin('invalid');

    await fillAndSubmit(person);

    expect(await screen.findByRole('alert')).toHaveTextContent('Неверный логин или пароль');
    expect(screen.getByRole('heading', { name: 'Вход' })).toBeInTheDocument();
  });

  it('слишком много попыток: показывает, через сколько повторить', async () => {
    const { person } = await openLogin('throttled');

    await fillAndSubmit(person);

    expect(await screen.findByRole('alert')).toHaveTextContent('Повторите через 15 мин.');
  });

  it('нет связи: понятное сообщение', async () => {
    const { person } = await openLogin('network');

    await fillAndSubmit(person);

    expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось связаться с сервером');
  });

  it('ошибка сервера не раскрывает подробностей', async () => {
    const { person } = await openLogin('server-error');

    await fillAndSubmit(person);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Не удалось войти. Попробуйте позже',
    );
    expect(screen.queryByText('boom')).not.toBeInTheDocument();
  });

  it('на время запроса кнопка заблокирована, повторное нажатие не шлёт второй запрос', async () => {
    const { server, person } = await openLogin();
    server.refreshDelay = 0;
    let release!: () => void;
    const original = vi.mocked(fetch).getMockImplementation()!;
    let loginRequests = 0;
    vi.mocked(fetch).mockImplementation(async (url, init) => {
      if (url === '/api/auth/login') {
        loginRequests++;
        await new Promise<void>((resolve) => (release = resolve));
      }
      return original(url, init);
    });

    await person.type(screen.getByLabelText('Логин'), 'misha');
    await person.type(screen.getByLabelText('Пароль'), 'secret-password-1');
    await person.click(screen.getByRole('button', { name: 'Войти' }));
    const busy = await screen.findByRole('button', { name: 'Входим…' });
    await person.click(busy);

    expect(busy).toBeDisabled();
    expect(loginRequests).toBe(1);
    release();
    await screen.findByRole('button', { name: 'Добавить расход' });
  });
});

describe('тихое обновление входа во время работы', () => {
  it('если access истёк посреди работы, запрос повторяется после обновления и пользователь ничего не замечает', async () => {
    const server = installFakeServer({ access: 'valid', refreshWorks: true });
    render(<App />);
    await screen.findByRole('button', { name: 'Добавить расход' });

    server.access = 'expired';
    await expect(apiRequest('/categories')).resolves.toMatchObject({ data: ['кафе', 'продукты'] });

    expect(server.count('POST /auth/refresh')).toBe(1);
    expect(screen.queryByRole('heading', { name: 'Вход' })).not.toBeInTheDocument();
  });

  it('несколько запросов с истёкшим входом ждут одно общее обновление', async () => {
    const server = installFakeServer({ access: 'valid', refreshWorks: true });
    render(<App />);
    await screen.findByRole('button', { name: 'Добавить расход' });
    server.refreshDelay = 30;
    server.access = 'expired';
    server.calls.length = 0;

    await Promise.all([apiRequest('/cards'), apiRequest('/categories'), apiRequest('/config')]);

    expect(server.count('POST /auth/refresh')).toBe(1);
  });

  it('повтор делается один раз: если после обновления снова 401, ошибка не зацикливается', async () => {
    const server = installFakeServer({ access: 'expired', refreshWorks: true });
    server.calls.length = 0;
    vi.mocked(fetch).mockImplementation(async (url) => {
      server.calls.push(`GET ${String(url).replace('/api', '')}`);
      if (url === '/api/auth/refresh') return ok({ refreshed: true });
      return fail(401, 'UNAUTHENTICATED', 'Требуется вход');
    });

    await expect(apiRequest('/cards')).rejects.toMatchObject({ status: 401 });

    expect(server.calls).toEqual(['GET /cards', 'GET /auth/refresh', 'GET /cards']);
  });

  it('если обновить вход не удалось, пользователь возвращается на форму входа', async () => {
    const server = installFakeServer({ access: 'valid', refreshWorks: false });
    render(<App />);
    await screen.findByRole('button', { name: 'Добавить расход' });

    server.access = 'expired';
    await expect(apiRequest('/categories')).rejects.toBeInstanceOf(ApiError);

    expect(await screen.findByRole('heading', { name: 'Вход' })).toBeInTheDocument();
  });

  it('сбой сети при обновлении не выбрасывает пользователя из системы', async () => {
    installFakeServer({ access: 'valid', refreshWorks: true });
    render(<App />);
    await screen.findByRole('button', { name: 'Добавить расход' });
    vi.mocked(fetch).mockImplementation(async (url) => {
      if (url === '/api/auth/refresh') throw new TypeError('Failed to fetch');
      return fail(401, 'UNAUTHENTICATED', 'Требуется вход');
    });

    await expect(apiRequest('/categories')).rejects.toMatchObject({ code: 'NETWORK' });

    expect(screen.queryByRole('heading', { name: 'Вход' })).not.toBeInTheDocument();
  });

  it('запросы входа и выхода не пытаются обновлять токен сами по себе', async () => {
    const server = installFakeServer({
      access: 'expired',
      refreshWorks: true,
      loginBehavior: 'invalid',
    });

    await expect(apiRequest('/auth/login', { method: 'POST', body: '{}' })).rejects.toMatchObject({
      status: 401,
    });

    expect(server.count('POST /auth/refresh')).toBe(0);
  });
});

describe('выход', () => {
  it('кнопка «Выйти» завершает сессию и показывает форму входа', async () => {
    const server = installFakeServer({ access: 'valid' });
    const person = userEvent.setup();
    render(<App />);
    await screen.findByRole('button', { name: 'Добавить расход' });

    await person.click(screen.getByRole('button', { name: 'Выйти' }));

    expect(await screen.findByRole('heading', { name: 'Вход' })).toBeInTheDocument();
    expect(server.count('POST /auth/logout')).toBe(1);
  });

  it('после выхода данные прошлого пользователя не остаются: следующий видит свою карту', async () => {
    const server = installFakeServer({ access: 'valid', user: MISHA });
    const person = userEvent.setup();
    render(<App />);
    await screen.findByRole('radio', { name: /Миша/ });
    await person.click(screen.getByRole('button', { name: 'Выйти' }));
    await screen.findByRole('heading', { name: 'Вход' });

    server.user = NASTYA;
    await person.type(screen.getByLabelText('Логин'), 'nastya');
    await person.type(screen.getByLabelText('Пароль'), 'secret-password-1');
    await person.click(screen.getByRole('button', { name: 'Войти' }));

    await waitFor(() => expect(screen.getByRole('radio', { name: /Настя/ })).toBeChecked());
    expect(screen.getByText('Настя', { selector: 'strong' })).toBeInTheDocument();
  });

  it('если выйти не удалось, пользователь остаётся и видит ошибку', async () => {
    installFakeServer({ access: 'valid' });
    const person = userEvent.setup();
    render(<App />);
    await screen.findByRole('button', { name: 'Добавить расход' });
    const original = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation(async (url, init) => {
      if (url === '/api/auth/logout') return fail(500, 'INTERNAL_ERROR', 'boom');
      return original(url, init);
    });

    await person.click(screen.getByRole('button', { name: 'Выйти' }));

    expect(await screen.findByText('Не удалось выйти')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Добавить расход' })).toBeInTheDocument();
  });
});

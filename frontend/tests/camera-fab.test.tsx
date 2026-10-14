import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { AppShell } from '../src/app/AppShell.tsx';
import { AddExpensePage } from '../src/pages/AddExpensePage.tsx';
import { Modal } from '../src/shared/ui/Modal.tsx';
import { PHOTO_ERROR } from '../src/shared/utils/image-compress.ts';
import {
  USER,
  allowPhotos,
  enableAi,
  server,
  setupOfflineHarness,
} from './helpers/offline-harness.tsx';

setupOfflineHarness();

/** A fake camera: getUserMedia gives a stream whose tracks can be counted. */
function mockCamera(behaviour?: (constraints: MediaStreamConstraints) => Promise<MediaStream>) {
  const stops = vi.fn();
  const stream = { getTracks: () => [{ stop: stops }, { stop: stops }] } as unknown as MediaStream;
  const getUserMedia = vi.fn(behaviour ?? (async () => stream));
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } });
  return { getUserMedia, stops, stream };
}

function Where() {
  const location = useLocation();
  return <output data-testid="path">{location.pathname}</output>;
}

function renderAt(path: string, extra?: React.ReactNode) {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route element={<AppShell user={USER} />}>
            <Route
              index
              element={
                <>
                  <AddExpensePage user={USER} />
                  {extra}
                </>
              }
            />
            <Route path="analytics/*" element={<p>Аналитика</p>} />
            <Route path="group" element={<p>Группа</p>} />
            <Route path="admin" element={<p>Админ</p>} />
            <Route path="settings" element={<p>Настройки</p>} />
          </Route>
        </Routes>
        <Where />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return userEvent.setup();
}

/** AI on, photos allowed in «кафе» and «продукты», the notice confirmed. */
function scenario({ confirmed = true } = {}) {
  enableAi();
  allowPhotos();
  server.receiptSettings = { enabled: true, categories: ['кафе', 'продукты'] };
  if (confirmed) server.preferences = { 'ai.noticeSeen': true };
}

const fab = () => screen.queryByRole('button', { name: 'Добавить чек' });
const galleryInput = () => screen.getByLabelText('Выбрать чек из галереи') as HTMLInputElement;
const shoot = (person: ReturnType<typeof userEvent.setup>) =>
  person.upload(galleryInput(), new File(['img'], 'check.jpg', { type: 'image/jpeg' }));

describe('круглая кнопка камеры', () => {
  it('на «Добавить» при доступном сценарии: нижний бар на всю ширину, только на телефоне', async () => {
    scenario();
    renderAt('/');

    const bar = await screen.findByRole('navigation', { name: 'Нижняя навигация' });

    expect(bar.className).toContain('fixed');
    expect(bar.className).toContain('inset-x-0');
    expect(bar.className).toContain('bottom-0');
    expect(bar.className).toContain('bg-white');
    expect(bar.className).toContain('pb-[env(safe-area-inset-bottom)]');
    expect(bar.parentElement!.className).toContain('md:hidden');
  });

  it('камера внутри бара: круглая 64px, по центру, aria-label и title', async () => {
    scenario();
    renderAt('/');
    const bar = await screen.findByRole('navigation', { name: 'Нижняя навигация' });

    const button = within(bar).getByRole('button', { name: 'Добавить чек' });

    expect(button).toHaveAttribute('title', 'Добавить чек');
    expect(button).toHaveAttribute('aria-haspopup', 'menu');
    expect(button.className).toContain('size-16');
    expect(button.className).toContain('bg-indigo-600');
    expect(button.className).toContain('-translate-x-1/2');
    // The hump of the bar around the button
    expect(bar.querySelector('[aria-hidden="true"].overflow-hidden')).not.toBeNull();
  });

  it('пункты «Добавить» слева и «Аналитика» справа ведут на свои страницы, высота не меньше 44px', async () => {
    scenario();
    renderAt('/analytics');
    const bar = within(await screen.findByRole('navigation', { name: 'Нижняя навигация' }));

    const add = bar.getByRole('link', { name: 'Добавить' });
    const analytics = bar.getByRole('link', { name: 'Аналитика' });
    expect(add).toHaveAttribute('href', '/');
    expect(analytics).toHaveAttribute('href', '/analytics');
    expect(add.className).toContain('min-h-14');
    expect(add.className).toContain('text-[11px]');
    expect(add.compareDocumentPosition(analytics) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('активный пункт подсвечен основным цветом, другой серый', async () => {
    scenario();
    renderAt('/analytics');
    const bar = within(await screen.findByRole('navigation', { name: 'Нижняя навигация' }));

    expect(bar.getByRole('link', { name: 'Аналитика' }).className).toContain('text-indigo-600');
    expect(bar.getByRole('link', { name: 'Добавить' }).className).toContain('text-zinc-500');
  });

  it('на «Добавить» активен пункт «Добавить»', async () => {
    scenario();
    renderAt('/');
    const bar = within(await screen.findByRole('navigation', { name: 'Нижняя навигация' }));

    expect(bar.getByRole('link', { name: 'Добавить' }).className).toContain('text-indigo-600');
  });

  it('скрытый input галереи: accept=image/*, без capture; input с capture больше нет', async () => {
    scenario();
    renderAt('/');
    await screen.findByRole('button', { name: 'Добавить чек' });

    expect(galleryInput()).toHaveAttribute('accept', 'image/*');
    expect(galleryInput()).not.toHaveAttribute('capture');
    expect(screen.queryByLabelText('Снять чек')).toBeNull();
  });

  it('на страницах аналитики кнопка есть', async () => {
    scenario();
    renderAt('/analytics');

    expect(await screen.findByRole('button', { name: 'Добавить чек' })).toBeInTheDocument();
  });

  it.each(['/group', '/admin', '/settings'])('на %s кнопки нет', async (path) => {
    scenario();
    renderAt(path);
    await screen.findByRole('navigation', { name: 'Разделы' });
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(fab()).toBeNull();
  });

  it('без ИИ бара нет вообще', async () => {
    allowPhotos();
    renderAt('/');
    await screen.findByRole('button', { name: 'Добавить расход' });
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(fab()).toBeNull();
    expect(screen.queryByRole('navigation', { name: 'Нижняя навигация' })).toBeNull();
  });

  it('фото чеков выключены: кнопки нет', async () => {
    enableAi();
    server.receiptSettings = { enabled: false, categories: [] };
    renderAt('/');
    await screen.findByRole('button', { name: 'Добавить расход' });
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(fab()).toBeNull();
  });

  it('нет категории с фото и ИИ сразу: кнопки нет', async () => {
    enableAi();
    server.receiptSettings = { enabled: true, categories: ['кафе'], aiCategories: ['продукты'] };
    renderAt('/');
    await screen.findByRole('button', { name: 'Добавить расход' });
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(fab()).toBeNull();
  });

  it('у страницы нижний отступ под бар и горб (6rem + safe-area), чтобы контент не перекрывался', async () => {
    scenario();
    renderAt('/');
    await screen.findByRole('button', { name: 'Добавить чек' });

    expect(screen.getByRole('main').className).toContain(
      'pb-[calc(6rem+env(safe-area-inset-bottom))]',
    );
  });

  it('без кнопки обычный отступ', async () => {
    renderAt('/group');
    await screen.findByRole('navigation', { name: 'Разделы' });

    expect(screen.getByRole('main').className).not.toContain('6rem');
  });
});

describe('съёмка', () => {
  it('со страницы аналитики: переход на «Добавить» и разбор без категории, форма заполняется', async () => {
    scenario();
    const person = renderAt('/analytics');
    await screen.findByRole('button', { name: 'Добавить чек' });

    await shoot(person);

    await waitFor(() => expect(screen.getByTestId('path')).toHaveTextContent(/^\/$/));
    await waitFor(() => expect(server.photoParses()).toHaveLength(1));
    expect(server.photoParses()[0]!.url).toBe('/api/ai/receipt/parse');
    expect(await screen.findByDisplayValue('Кофейня')).toBeInTheDocument();
    expect(screen.getByAltText('Фото чека')).toBeInTheDocument();
  });

  it('плашка про Google, если не подтверждена: до подтверждения ничего не уходит', async () => {
    scenario({ confirmed: false });
    const person = renderAt('/analytics');
    await screen.findByRole('button', { name: 'Добавить чек' });

    await shoot(person);

    expect(
      await screen.findByText('Чек будет отправлен на разбор в Google (Gemini)'),
    ).toBeInTheDocument();
    expect(server.photoParses()).toHaveLength(0);
    await person.click(screen.getByRole('button', { name: 'Понятно' }));
    await waitFor(() => expect(server.photoParses()).toHaveLength(1));
  });

  it('на «Добавить» заменяет текущее фото: новый разбор', async () => {
    scenario();
    const person = renderAt('/');
    await screen.findByRole('button', { name: 'Добавить чек' });
    await shoot(person);
    await waitFor(() => expect(server.photoParses()).toHaveLength(1));
    await screen.findByDisplayValue('Кофейня');

    await shoot(person);

    await waitFor(() => expect(server.photoParses()).toHaveLength(2));
    expect(screen.getByTestId('path')).toHaveTextContent(/^\/$/);
  });

  it('отмена камеры (файла нет) ничего не делает', async () => {
    scenario();
    renderAt('/analytics');
    await screen.findByRole('button', { name: 'Добавить чек' });

    fireEvent.change(galleryInput(), { target: { files: [] } });
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(screen.getByTestId('path')).toHaveTextContent('/analytics');
    expect(server.photoParses()).toHaveLength(0);
  });

  it('не удалось обработать фото: то же сообщение, что у обычного выбора, без перехода', async () => {
    scenario();
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => Promise.reject(new Error('decode'))),
    );
    const person = renderAt('/analytics');
    await screen.findByRole('button', { name: 'Добавить чек' });

    await shoot(person);

    expect(await screen.findByRole('alert')).toHaveTextContent(PHOTO_ERROR);
    expect(screen.getByTestId('path')).toHaveTextContent('/analytics');
  });
});

describe('когда кнопку нужно спрятать', () => {
  it('пока открыто модальное окно', async () => {
    scenario();
    renderAt(
      '/',
      <Modal title="Окно" onClose={() => undefined}>
        <p>Содержимое</p>
      </Modal>,
    );
    await screen.findByRole('dialog', { name: 'Окно' });

    expect(fab()).toBeNull();
  });

  it('пока открыта экранная клавиатура (visualViewport заметно меньше окна)', async () => {
    scenario();
    vi.stubGlobal('visualViewport', {
      height: 300,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    });
    Object.defineProperty(window, 'visualViewport', {
      configurable: true,
      value: {
        height: 300,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      },
    });
    renderAt('/');
    await screen.findByRole('button', { name: 'Добавить расход' });
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(fab()).toBeNull();
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: undefined });
  });
});

describe('верхние вкладки при нижнем баре', () => {
  const tabs = () => screen.getByRole('navigation', { name: 'Разделы' });

  it('бар есть: верхние вкладки скрыты на телефоне и всегда видны от md', async () => {
    scenario();
    renderAt('/');
    await screen.findByRole('navigation', { name: 'Нижняя навигация' });

    expect(tabs().className).toContain('max-md:hidden');
    // Only below md: on a desktop (md and up) the tabs stay as they were
    expect(tabs().className).not.toMatch(/(^|\s)hidden(\s|$)/);
  });

  it('бара нет (без ИИ): вкладки остаются и на телефоне', async () => {
    allowPhotos();
    renderAt('/');
    await screen.findByRole('button', { name: 'Добавить расход' });
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(tabs().className).not.toContain('max-md:hidden');
    expect(within(tabs()).getByRole('link', { name: 'Добавить' })).toBeInTheDocument();
  });

  it('пока статус ИИ не получен, вкладки показаны (без мигания)', async () => {
    scenario();
    renderAt('/');

    expect(tabs().className).not.toContain('max-md:hidden');
    await screen.findByRole('navigation', { name: 'Нижняя навигация' });
    expect(tabs().className).toContain('max-md:hidden');
  });

  it.each(['/group', '/admin', '/settings'])('на %s вкладки остаются', async (path) => {
    scenario();
    renderAt(path);
    await screen.findByRole('navigation', { name: 'Разделы' });
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(tabs().className).not.toContain('max-md:hidden');
  });

  it('шапка и меню пользователя на месте', async () => {
    scenario();
    renderAt('/');
    await screen.findByRole('navigation', { name: 'Нижняя навигация' });

    expect(screen.getByRole('heading', { name: /Мои расходы/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Меню пользователя/ })).toBeInTheDocument();
  });
});

describe('выбор источника фото', () => {
  const openMenu = async (person: ReturnType<typeof userEvent.setup>) => {
    await person.click(await screen.findByRole('button', { name: 'Добавить чек' }));
    return within(await screen.findByRole('menu', { name: 'Источник фото' }));
  };

  it('нажатие на камеру открывает меню с двумя пунктами; кнопка не перекрыта', async () => {
    scenario();
    const person = renderAt('/');

    const menu = await openMenu(person);

    expect(menu.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      'Сфотографировать',
      'Выбрать из галереи',
    ]);
    const root = screen.getByRole('menu', { name: 'Источник фото' });
    expect(root.className).toContain('bottom-[calc(100%+41px)]');
    expect(screen.getByRole('button', { name: 'Добавить чек' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    for (const item of menu.getAllByRole('menuitem')) expect(item.className).toContain('min-h-11');
  });

  it('«Сфотографировать» открывает камеру приложения, меню закрывается, input галереи не кликается', async () => {
    scenario();
    mockCamera();
    const person = renderAt('/');
    await screen.findByRole('button', { name: 'Добавить чек' });
    const other = vi.spyOn(galleryInput(), 'click').mockImplementation(() => undefined);
    const menu = await openMenu(person);

    await person.click(menu.getByRole('menuitem', { name: 'Сфотографировать' }));

    expect(await screen.findByRole('dialog', { name: 'Камера' })).toBeInTheDocument();
    expect(other).not.toHaveBeenCalled();
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('«Выбрать из галереи» кликает input без capture', async () => {
    scenario();
    const person = renderAt('/');
    await screen.findByRole('button', { name: 'Добавить чек' });
    const gallery = vi.spyOn(galleryInput(), 'click').mockImplementation(() => undefined);
    const menu = await openMenu(person);

    await person.click(menu.getByRole('menuitem', { name: 'Выбрать из галереи' }));

    expect(gallery).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog', { name: 'Камера' })).toBeNull();
  });

  it('Escape и клик вне закрывают меню', async () => {
    scenario();
    const person = renderAt('/');
    await openMenu(person);

    await person.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();

    await openMenu(person);
    await person.click(document.body);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('файл из галереи идёт тем же путём: разбор запускается', async () => {
    scenario();
    const person = renderAt('/analytics');
    await screen.findByRole('button', { name: 'Добавить чек' });

    await person.upload(galleryInput(), new File(['img'], 'gallery.jpg', { type: 'image/jpeg' }));

    await waitFor(() => expect(screen.getByTestId('path')).toHaveTextContent(/^\/$/));
    await waitFor(() => expect(server.photoParses()).toHaveLength(1));
  });
});

describe('кнопка фото на форме «Добавить»', () => {
  const stubPhone = () =>
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));

  it('на десктопе (мышь) — прямой выбор файла без меню', async () => {
    scenario();
    const person = renderAt('/');
    const input = await screen.findByLabelText('Выбрать фото чека');
    const click = vi.spyOn(input, 'click').mockImplementation(() => undefined);
    await person.selectOptions(screen.getByLabelText('Категория'), 'кафе');

    await person.click(await screen.findByRole('button', { name: 'Прикрепить фото чека' }));

    expect(click).toHaveBeenCalled();
    expect(screen.queryByRole('menu', { name: 'Источник фото' })).toBeNull();
  });

  it('на телефоне открывает меню «Сфотографировать / Выбрать из галереи»', async () => {
    scenario();
    stubPhone();
    const person = renderAt('/');
    await person.selectOptions(await screen.findByLabelText('Категория'), 'кафе');

    await person.click(await screen.findByRole('button', { name: 'Прикрепить фото чека' }));

    const menu = within(await screen.findByRole('menu', { name: 'Источник фото' }));
    expect(menu.getByRole('menuitem', { name: 'Сфотографировать' })).toBeInTheDocument();
    expect(menu.getByRole('menuitem', { name: 'Выбрать из галереи' })).toBeInTheDocument();
  });

  it('«Сфотографировать» из меню формы открывает камеру, снимок запускает разбор', async () => {
    scenario();
    stubPhone();
    const camera = mockCamera();
    const person = renderAt('/');
    await person.selectOptions(await screen.findByLabelText('Категория'), 'кафе');
    await person.click(await screen.findByRole('button', { name: 'Прикрепить фото чека' }));

    await person.click(await screen.findByRole('menuitem', { name: 'Сфотографировать' }));
    await person.click(await screen.findByRole('button', { name: 'Сделать снимок' }));

    await waitFor(() => expect(server.photoParses()).toHaveLength(1));
    expect(camera.stops).toHaveBeenCalled();
    expect(screen.queryByRole('dialog', { name: 'Камера' })).toBeNull();
  });
});

describe('меню только там, где оно нужно', () => {
  const UA = {
    iphone:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 Version/17.4 Mobile/15E148 Safari/604.1',
    samsung:
      'Mozilla/5.0 (Linux; Android 14; SAMSUNG SM-S918B) AppleWebKit/537.36 SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36',
    chrome:
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/124.0.0.0 Mobile Safari/537.36',
  };
  const withUa = (value: string) => vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(value);

  it.each([
    ['iPhone', UA.iphone],
    ['Samsung Internet', UA.samsung],
  ])(
    '%s: нажатие на камеру сразу открывает простой input без capture, меню нет',
    async (_name, ua) => {
      scenario();
      withUa(ua);
      const person = renderAt('/');
      await screen.findByRole('button', { name: 'Добавить чек' });
      const gallery = vi.spyOn(galleryInput(), 'click').mockImplementation(() => undefined);

      await person.click(screen.getByRole('button', { name: 'Добавить чек' }));

      expect(gallery).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole('dialog', { name: 'Камера' })).toBeNull();
      expect(screen.queryByRole('menu')).toBeNull();
    },
  );

  it('Chrome на Android: остаётся меню из двух пунктов', async () => {
    scenario();
    withUa(UA.chrome);
    const person = renderAt('/');
    await person.click(await screen.findByRole('button', { name: 'Добавить чек' }));

    expect(await screen.findByRole('menu', { name: 'Источник фото' })).toBeInTheDocument();
  });

  it('форма на телефоне: iPhone и Samsung — «Прикрепить фото чека» открывает выбор сразу', async () => {
    scenario();
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
    withUa(UA.samsung);
    const person = renderAt('/');
    await person.selectOptions(await screen.findByLabelText('Категория'), 'кафе');
    const input = await screen.findByLabelText('Выбрать фото чека');
    const click = vi.spyOn(input, 'click').mockImplementation(() => undefined);

    await person.click(await screen.findByRole('button', { name: 'Прикрепить фото чека' }));

    expect(click).toHaveBeenCalled();
    expect(screen.queryByRole('menu', { name: 'Источник фото' })).toBeNull();
  });
});

describe('камера приложения', () => {
  const openCamera = async (person: ReturnType<typeof userEvent.setup>) => {
    await person.click(await screen.findByRole('button', { name: 'Добавить чек' }));
    await person.click(await screen.findByRole('menuitem', { name: 'Сфотографировать' }));
    return screen.findByRole('dialog', { name: 'Камера' });
  };
  const denied = (name: string) => async () => {
    throw Object.assign(new Error(name), { name });
  };

  it('просит заднюю камеру (environment), без звука; слой полноэкранный, выше бара и окон', async () => {
    scenario();
    const camera = mockCamera();
    const person = renderAt('/');

    const layer = await openCamera(person);

    await waitFor(() => expect(camera.getUserMedia).toHaveBeenCalledTimes(1));
    expect(camera.getUserMedia).toHaveBeenCalledWith({
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 2560 },
        height: { ideal: 1440 },
      },
      audio: false,
    });
    expect(layer.className).toContain('z-[60]');
    expect(layer.className).toContain('bg-black');
    expect(screen.getByText('Наведите камеру на чек')).toBeInTheDocument();
    const video = layer.querySelector('video')!;
    expect(video).toHaveAttribute('playsinline');
    expect(video.muted).toBe(true);
  });

  it('пока камера запускается — «Запускаем камеру…», затвор неактивен', async () => {
    scenario();
    mockCamera(() => new Promise<MediaStream>(() => undefined));
    const person = renderAt('/');

    await openCamera(person);

    expect(screen.getByText('Запускаем камеру…')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Сделать снимок' })).toBeDisabled();
  });

  it('затвор отдаёт JPEG в путь добавления фото, закрывает слой и останавливает треки', async () => {
    scenario();
    const camera = mockCamera();
    const person = renderAt('/analytics');
    await openCamera(person);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Сделать снимок' })).toBeEnabled(),
    );

    await person.click(screen.getByRole('button', { name: 'Сделать снимок' }));

    expect(screen.queryByRole('dialog', { name: 'Камера' })).toBeNull();
    expect(camera.stops).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(screen.getByTestId('path')).toHaveTextContent(/^\/$/));
    await waitFor(() => expect(server.photoParses()).toHaveLength(1));
    expect(server.photoParses()[0]!.headers.get('Content-Type')).toBe('image/jpeg');
  });

  it('закрытие крестиком останавливает треки', async () => {
    scenario();
    const camera = mockCamera();
    const person = renderAt('/');
    await openCamera(person);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Сделать снимок' })).toBeEnabled(),
    );

    await person.click(screen.getByRole('button', { name: 'Закрыть камеру' }));

    expect(screen.queryByRole('dialog', { name: 'Камера' })).toBeNull();
    expect(camera.stops).toHaveBeenCalledTimes(2);
    expect(server.photoParses()).toHaveLength(0);
  });

  it('Escape закрывает слой', async () => {
    scenario();
    mockCamera();
    const person = renderAt('/');
    await openCamera(person);

    await person.keyboard('{Escape}');

    expect(screen.queryByRole('dialog', { name: 'Камера' })).toBeNull();
  });

  it('размонтирование останавливает треки', async () => {
    scenario();
    const camera = mockCamera();
    const person = renderAt('/');
    await openCamera(person);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Сделать снимок' })).toBeEnabled(),
    );

    cleanup();

    expect(camera.stops).toHaveBeenCalledTimes(2);
  });

  it('отказ в доступе: понятный текст про разрешение, кнопки; затвора и подсказки нет, ✕ на подложке', async () => {
    scenario();
    mockCamera(denied('NotAllowedError'));
    const person = renderAt('/');
    const layer = await openCamera(person);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Доступ к камере запрещён. Разрешите камеру для этого сайта в настройках браузера (значок слева от адреса → Разрешения) или выберите фото из галереи',
    );
    expect(screen.getByRole('button', { name: 'Выбрать из галереи' })).toBeInTheDocument();
    expect(within(layer).queryByRole('button', { name: 'Сделать снимок' })).toBeNull();
    expect(screen.queryByText('Наведите камеру на чек')).toBeNull();
    expect(screen.getByRole('button', { name: 'Закрыть камеру' }).className).toContain(
      'bg-black/60',
    );
    expect(screen.getByRole('heading', { name: 'Камера недоступна' })).toBeInTheDocument();
    await person.click(screen.getByRole('button', { name: 'Закрыть' }));
    expect(screen.queryByRole('dialog', { name: 'Камера' })).toBeNull();
  });

  it('SecurityError — тот же текст; «Выбрать из галереи» открывает input без capture', async () => {
    scenario();
    mockCamera(denied('SecurityError'));
    const person = renderAt('/');
    await screen.findByRole('button', { name: 'Добавить чек' });
    const gallery = vi.spyOn(galleryInput(), 'click').mockImplementation(() => undefined);
    await openCamera(person);

    expect(await screen.findByRole('alert')).toHaveTextContent(/^Доступ к камере запрещён/);
    await person.click(await screen.findByRole('button', { name: 'Выбрать из галереи' }));

    expect(gallery).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog', { name: 'Камера' })).toBeNull();
  });

  it('небезопасная страница (isSecureContext = false): текст про https', async () => {
    scenario();
    mockCamera();
    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: false });
    const person = renderAt('/');
    await openCamera(person);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Камера работает только на защищённых страницах (https). Откройте приложение по https-адресу или выберите фото из галереи',
    );
    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true });
  });

  it('нет mediaDevices: тоже текст про https', async () => {
    scenario();
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: undefined });
    const person = renderAt('/');
    await openCamera(person);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /^Камера работает только на защищённых страницах/,
    );
    expect(screen.getByRole('button', { name: 'Выбрать из галереи' })).toBeInTheDocument();
  });

  it('NotFoundError (после повтора): «Камера не найдена»', async () => {
    scenario();
    const getUserMedia = vi
      .fn()
      .mockRejectedValue(Object.assign(new Error('x'), { name: 'NotFoundError' }));
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia },
    });
    const person = renderAt('/');
    await openCamera(person);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Камера не найдена. Выберите фото из галереи',
    );
    expect(getUserMedia).toHaveBeenCalledTimes(2);
  });

  it('NotReadableError: «Камера занята другим приложением»', async () => {
    scenario();
    mockCamera(denied('NotReadableError'));
    const person = renderAt('/');
    await openCamera(person);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Камера занята другим приложением. Закройте его или выберите фото из галереи',
    );
  });

  it('прочая ошибка: общий текст', async () => {
    scenario();
    mockCamera(denied('AbortError'));
    const person = renderAt('/');
    await openCamera(person);

    expect(await screen.findByRole('alert')).toHaveTextContent(/^Нет доступа к камере/);
  });

  it('OverconstrainedError: повтор с упрощёнными ограничениями (video: true)', async () => {
    scenario();
    const stops = vi.fn();
    const stream = { getTracks: () => [{ stop: stops }] } as unknown as MediaStream;
    const getUserMedia = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error('x'), { name: 'OverconstrainedError' }))
      .mockResolvedValueOnce(stream);
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia },
    });
    const person = renderAt('/');
    await openCamera(person);

    await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(2));
    expect(getUserMedia).toHaveBeenLastCalledWith({ video: true, audio: false });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Сделать снимок' })).toBeEnabled(),
    );
  });
});

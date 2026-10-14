import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  DRAFT_TTL_MS,
  clearAllDrafts,
  loadDraft,
  saveDraft,
  settleDraftWrites,
} from '../src/features/offline-queue/model/draft-store.ts';
import type { FormDraftData } from '../src/features/expenses/model/form-draft.ts';
import {
  allowPhotos,
  enableAi,
  fillForm,
  pickPhoto,
  renderApp,
  server,
  setupOfflineHarness,
  submit,
} from './helpers/offline-harness.tsx';

setupOfflineHarness();

const USER = 'misha';

const draftOf = (
  patch: Partial<FormDraftData['values']> = {},
  extra: Partial<FormDraftData> = {},
): FormDraftData => ({
  values: {
    date: '2026-10-10',
    card: 'Миша',
    category: 'кафе',
    name: 'Из черновика',
    currency: 'AMD',
    amount: '1 500',
    rate: '',
    ...patch,
  },
  items: [],
  dateTouched: false,
  ai: { name: null, date: null, amount: null, category: null, parse: { status: 'idle' } },
  ...extra,
});

/** The page goes to the background: the only reliable moment on a phone. */
async function hide() {
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
  document.dispatchEvent(new Event('visibilitychange'));
  await settleDraftWrites();
}

async function reopen() {
  await hide();
  cleanup();
  vi.restoreAllMocks();
  return renderApp();
}

const scenario = () => {
  enableAi();
  allowPhotos();
  server.receiptSettings = { enabled: true, categories: ['кафе', 'продукты'] };
  server.preferences = { 'ai.noticeSeen': true };
};

describe('хранилище черновика', () => {
  it('сохраняет и возвращает черновик пользователя вместе с фото', async () => {
    const photo = new Blob(['jpeg'], { type: 'image/jpeg' });
    await saveDraft(USER, draftOf({}, { photo }));

    const stored = await loadDraft(USER);

    expect(stored!.data.values.name).toBe('Из черновика');
    expect(stored!.data.photo).toBeInstanceOf(Blob);
    expect(stored!.data.photo!.type).toBe('image/jpeg');
  });

  it('черновик старше 24 часов не возвращается и удаляется', async () => {
    await saveDraft(USER, draftOf(), Date.now() - DRAFT_TTL_MS - 1000);

    expect(await loadDraft(USER)).toBeNull();
    expect(await loadDraft(USER, Date.now() - DRAFT_TTL_MS * 2)).toBeNull();
  });

  it('черновик другого пользователя не отдаётся', async () => {
    await saveDraft('other', draftOf());

    expect(await loadDraft(USER)).toBeNull();
    expect(await loadDraft('other')).not.toBeNull();
  });

  it('выход из аккаунта стирает все черновики', async () => {
    await saveDraft(USER, draftOf());
    await saveDraft('other', draftOf());

    await clearAllDrafts();

    expect(await loadDraft(USER)).toBeNull();
    expect(await loadDraft('other')).toBeNull();
  });
});

describe('черновик формы «Добавить»', () => {
  it('сохраняется сразу при visibilitychange (hidden)', async () => {
    const { person } = await renderApp();
    await fillForm(person, 'Магазин', '2500');

    await hide();

    const stored = await loadDraft(USER);
    expect(stored!.data.values).toMatchObject({
      name: 'Магазин',
      amount: '2 500',
      category: 'кафе',
    });
  });

  it('сохраняется сразу при pagehide', async () => {
    const { person } = await renderApp();
    await fillForm(person, 'Магазин');

    window.dispatchEvent(new Event('pagehide'));
    await settleDraftWrites();

    expect((await loadDraft(USER))!.data.values.name).toBe('Магазин');
  });

  it('и с дебаунсом около 400 мс после изменения, без ухода страницы', async () => {
    const { person } = await renderApp();
    await fillForm(person, 'Магазин');

    await waitFor(async () => expect((await loadDraft(USER))?.data.values.name).toBe('Магазин'), {
      timeout: 2000,
    });
  });

  it('пустая форма не сохраняется', async () => {
    await renderApp();

    await hide();

    expect(await loadDraft(USER)).toBeNull();
  });

  it('восстанавливается: поля, плашка «Восстановлен несохранённый черновик»', async () => {
    const { person } = await renderApp();
    await fillForm(person, 'Магазин', '2500');
    await person.selectOptions(screen.getByLabelText('Карта'), 'Настя');

    await reopen();

    expect(await screen.findByDisplayValue('Магазин')).toBeInTheDocument();
    expect(screen.getByLabelText('Стоимость')).toHaveValue('2 500');
    expect(screen.getByLabelText('Карта')).toHaveValue('Настя');
    expect(screen.getByLabelText('Категория')).toHaveValue('кафе');
    expect(screen.getByText('Восстановлен несохранённый черновик')).toBeInTheDocument();
  });

  it('восстанавливается вместе с фото: миниатюра на месте', async () => {
    allowPhotos();
    const { person } = await renderApp();
    await pickPhoto(person);
    await person.type(screen.getByLabelText('Наименование'), 'Чек');

    await reopen();

    expect(await screen.findByDisplayValue('Чек')).toBeInTheDocument();
    expect(await screen.findByAltText('Фото чека')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Посмотреть чек' })).toBeInTheDocument();
  });

  it('фото сохраняется сразу при получении, не дожидаясь паузы', async () => {
    allowPhotos();
    const { person } = await renderApp();

    await pickPhoto(person);
    await settleDraftWrites();

    expect((await loadDraft(USER))!.data.photo).toBeInstanceOf(Blob);
  });

  it('удаление фото обновляет черновик', async () => {
    allowPhotos();
    const { person } = await renderApp();
    await pickPhoto(person);
    await person.type(screen.getByLabelText('Наименование'), 'Чек');
    await waitFor(async () => expect((await loadDraft(USER))?.data.photo).toBeInstanceOf(Blob));

    await person.click(screen.getByRole('button', { name: 'Убрать фото' }));

    await waitFor(async () => expect((await loadDraft(USER))?.data.photo).toBeUndefined());
  });

  it('разбор ещё шёл при сохранении: после восстановления повторяется один раз', async () => {
    scenario();
    server.parsePhoto = () => new Promise<Response>(() => undefined);
    const { person } = await renderApp();
    await pickPhoto(person);
    await screen.findByText('Распознаём чек…');
    expect(server.photoParses()).toHaveLength(1);
    server.parsePhoto = () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            success: true,
            data: {
              parseId: 'p9',
              category: null,
              name: 'Кофейня',
              date: null,
              items: [],
              total: null,
              currency: null,
              dropped: 0,
            },
          }),
          { status: 200 },
        ),
      );

    await reopen();

    expect(await screen.findByDisplayValue('Кофейня')).toBeInTheDocument();
    expect(server.photoParses()).toHaveLength(2);
  });

  it('разбор был закончен: результат и пометки возвращаются, второго разбора нет', async () => {
    scenario();
    await renderApp().then(async ({ person }) => {
      await pickPhoto(person);
      await screen.findByDisplayValue('Кофейня');
    });
    expect(server.photoParses()).toHaveLength(1);

    await reopen();

    expect(await screen.findByDisplayValue('Кофейня')).toBeInTheDocument();
    expect(screen.getByText('Чек распознан')).toBeInTheDocument();
    expect(
      screen.getAllByRole('img', { name: 'Сгенерировано с помощью AI' }).length,
    ).toBeGreaterThan(0);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(server.photoParses()).toHaveLength(1);
  });

  it('«Очистить» убирает плашку, поля, фото и черновик', async () => {
    allowPhotos();
    const { person } = await renderApp();
    await pickPhoto(person);
    await person.type(screen.getByLabelText('Наименование'), 'Чек');
    const next = await reopen();
    await screen.findByText(/Восстановлен несохранённый черновик/);

    await next.person.click(screen.getByRole('button', { name: 'Очистить' }));

    expect(screen.queryByText(/Восстановлен/)).toBeNull();
    expect(screen.getByLabelText('Наименование')).toHaveValue('');
    expect(screen.queryByAltText('Фото чека')).toBeNull();
    await waitFor(async () => expect(await loadDraft(USER)).toBeNull());
  });

  it('после успешного сохранения черновик стирается', async () => {
    const { person } = await renderApp();
    await fillForm(person, 'Магазин', '2500');
    await hide();
    expect(await loadDraft(USER)).not.toBeNull();
    vi.restoreAllMocks();

    await submit(person);
    await screen.findByText('Расход успешно добавлен');

    await waitFor(async () => expect(await loadDraft(USER)).toBeNull());
  });

  it('расход поставлен в очередь без сети: черновик тоже стирается', async () => {
    const { person } = await renderApp();
    await fillForm(person, 'Магазин', '2500');
    server.network = false;
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });

    await submit(person);
    await screen.findByText('Сохранено на устройстве, отправится при появлении сети');

    await waitFor(async () => expect(await loadDraft(USER)).toBeNull());
  });

  it('черновик старше суток не восстанавливается', async () => {
    await saveDraft(USER, draftOf(), Date.now() - DRAFT_TTL_MS - 60_000);

    await renderApp();
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(screen.getByLabelText('Наименование')).toHaveValue('');
    expect(screen.queryByText(/Восстановлен/)).toBeNull();
  });

  it('черновик другого пользователя не подхватывается', async () => {
    await saveDraft('other', draftOf());

    await renderApp();
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(screen.getByLabelText('Наименование')).toHaveValue('');
    expect(screen.queryByText(/Восстановлен/)).toBeNull();
  });

  it('свежий черновик приложения подхватывается при открытии', async () => {
    await saveDraft(USER, draftOf({ name: 'Вчерашний набросок' }));

    await renderApp();

    expect(await screen.findByDisplayValue('Вчерашний набросок')).toBeInTheDocument();
  });
});

describe('уведомление о восстановленном черновике', () => {
  const toast = () =>
    screen.getByText('Восстановлен несохранённый черновик').closest('[role="status"]')!;
  async function restored() {
    await saveDraft(USER, draftOf({ name: 'Набросок' }));
    return renderApp();
  }

  it('короткое всплывающее уведомление сверху: не двигает форму и не прячется за нижним баром', async () => {
    await restored();
    await screen.findByDisplayValue('Набросок');

    const element = toast();
    expect(element.className).toContain('fixed');
    expect(element.className).toContain('top-[max(0.75rem,env(safe-area-inset-top))]');
    expect(element.className).not.toContain('bottom-');
    expect(element.className).toContain('z-40');
  });

  it('исчезает само: таймер на 4 секунды', async () => {
    const timers = vi.spyOn(globalThis, 'setTimeout');
    await restored();
    await screen.findByText('Восстановлен несохранённый черновик');

    const call = timers.mock.calls.find(([, delay]) => delay === 4000);
    expect(call).toBeDefined();
    await act(async () => (call![0] as () => void)());

    // It fades out first, then goes away
    await waitFor(() =>
      expect(screen.queryByText('Восстановлен несохранённый черновик')).toBeNull(),
    );
    // The form keeps what was restored
    expect(screen.getByLabelText('Наименование')).toHaveValue('Набросок');
  });

  it('появляется и уходит плавно: прозрачность и сдвиг с переходом, уважает reduce-motion', async () => {
    await restored();
    await screen.findByText('Восстановлен несохранённый черновик');

    const element = toast();
    expect(element.className).toContain('transition');
    expect(element.className).toContain('duration-200');
    expect(element.className).toContain('motion-reduce:transition-none');
    await waitFor(() => expect(toast().className).toContain('opacity-100'));
    const person = (await import('@testing-library/user-event')).default.setup();
    await person.click(document.body);
    await waitFor(() => expect(toast().className).toContain('opacity-0'));
  });

  it('смахивается жестом вверх: уходит; короткий сдвиг возвращается на место', async () => {
    await restored();
    await screen.findByText('Восстановлен несохранённый черновик');

    fireEvent.pointerDown(toast(), { clientY: 100 });
    fireEvent.pointerMove(toast(), { clientY: 90 });
    fireEvent.pointerUp(toast());
    await waitFor(() => expect((toast() as HTMLElement).style.transform).toBe(''));
    expect(screen.queryByText('Восстановлен несохранённый черновик')).not.toBeNull();

    fireEvent.pointerDown(toast(), { clientY: 100 });
    fireEvent.pointerMove(toast(), { clientY: 40 });
    expect((toast() as HTMLElement).style.transform).toBe('translateY(-60px)');
    fireEvent.pointerUp(toast());

    await waitFor(() =>
      expect(screen.queryByText('Восстановлен несохранённый черновик')).toBeNull(),
    );
  });

  it('вниз не тянется: сдвиг только вверх', async () => {
    await restored();
    await screen.findByText('Восстановлен несохранённый черновик');

    fireEvent.pointerDown(toast(), { clientY: 100 });
    fireEvent.pointerMove(toast(), { clientY: 160 });

    expect((toast() as HTMLElement).style.transform).toBe('');
    fireEvent.pointerUp(toast());
  });

  it('исчезает при правке поля', async () => {
    const { person } = await restored();
    await screen.findByText('Восстановлен несохранённый черновик');

    await person.type(screen.getByLabelText('Стоимость'), '5');

    await waitFor(() =>
      expect(screen.queryByText('Восстановлен несохранённый черновик')).toBeNull(),
    );
  });

  it('исчезает по касанию вне уведомления', async () => {
    const { person } = await restored();
    await screen.findByText('Восстановлен несохранённый черновик');

    await person.click(document.body);

    await waitFor(() =>
      expect(screen.queryByText('Восстановлен несохранённый черновик')).toBeNull(),
    );
    expect(screen.getByLabelText('Наименование')).toHaveValue('Набросок');
  });

  it('«Очистить» внутри уведомления сбрасывает форму и черновик', async () => {
    const { person } = await restored();
    await screen.findByText('Восстановлен несохранённый черновик');

    await person.click(within(toast() as HTMLElement).getByRole('button', { name: 'Очистить' }));

    expect(screen.queryByText('Восстановлен несохранённый черновик')).toBeNull();
    expect(screen.getByLabelText('Наименование')).toHaveValue('');
    await waitFor(async () => expect(await loadDraft(USER)).toBeNull());
  });
});

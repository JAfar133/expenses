import { describe, expect, it } from 'vitest';
import type { ExpenseItem } from '../src/features/items/api/items.api.ts';
import {
  draftsToInputs,
  emptyDraft,
  inputsToDrafts,
  isAiGenerated,
  itemsToDrafts,
  type DraftItem,
} from '../src/features/items/model/draft-items.ts';
import { discrepancyNote, sumItems } from '../src/features/items/model/items-sum.ts';
import { itemsLabel } from '../src/features/items/model/plural.ts';
import { sanitizePreferences } from '../src/features/preferences/model/preferences.ts';
import { parseFailureMessage } from '../src/features/ai/model/parse-runner.ts';
import { ApiError } from '../src/shared/api/http.ts';

const row = (patch: Partial<DraftItem>): DraftItem => ({ ...emptyDraft(), ...patch });

describe('позиции: строки редактора в запрос', () => {
  it('цена и количество с запятой или точкой, дробные цены и в драмах', () => {
    const result = draftsToInputs([
      row({ name: ' Хлеб ', price: '1 249,50', quantity: '0,350' }),
      row({ name: 'Молоко', price: '99.9' }),
    ]);

    expect(result).toEqual({
      items: [
        { name: 'Хлеб', price: 1249.5, quantity: 0.35 },
        { name: 'Молоко', price: 99.9 },
      ],
    });
  });

  it('пустые строки пропускаются; у существующих позиций сохраняется id', () => {
    const result = draftsToInputs([row({}), row({ id: 'i-1', name: 'Сыр', price: '300' })]);

    expect(result).toEqual({ items: [{ id: 'i-1', name: 'Сыр', price: 300 }] });
  });

  it.each([
    [{ name: '', price: '10' }, 'Позиция 1: укажите название'],
    [{ name: 'Хлеб', price: '' }, 'Позиция 1: укажите цену'],
    [{ name: 'Хлеб', price: 'abc' }, 'Позиция 1: укажите цену'],
    [{ name: 'Хлеб', price: '10', quantity: '0' }, 'Позиция 1: количество должно быть больше нуля'],
    [{ name: 'я'.repeat(201), price: '10' }, 'Позиция 1: название не длиннее 200 символов'],
  ])('ошибка заполнения %o', (patch, message) => {
    expect(draftsToInputs([row(patch)])).toEqual({ error: message });
  });

  it('не больше 100 позиций', () => {
    const many = Array.from({ length: 101 }, () => row({ name: 'x', price: '1' }));

    expect(draftsToInputs(many)).toEqual({ error: 'Не больше 100 позиций' });
  });
});

describe('позиции: с сервера в строки и пометка ИИ', () => {
  const server: ExpenseItem[] = [
    { id: 'a', position: 1, name: 'Латте', price: 1249.5, quantity: 1, source: 'ai' },
    { id: 'b', position: 2, name: 'Сыр', price: 300, quantity: 0.35, source: 'manual' },
  ];

  it('цена с запятой, количество 1 не показывается', () => {
    const [first, second] = itemsToDrafts(server);

    expect(first).toMatchObject({ id: 'a', name: 'Латте', price: '1 249,5', quantity: '' });
    expect(second).toMatchObject({ price: '300', quantity: '0,35' });
  });

  it('пометка есть у сгенерированной позиции, пока её не изменили', () => {
    const [ai, manual] = itemsToDrafts(server);

    expect(isAiGenerated(ai!)).toBe(true);
    expect(isAiGenerated(manual!)).toBe(false);
    expect(isAiGenerated({ ...ai!, name: 'Капучино' })).toBe(false);
    expect(isAiGenerated({ ...ai!, price: '1 000' })).toBe(false);
    expect(isAiGenerated({ ...ai!, quantity: '2' })).toBe(false);
  });

  it('позиции из очереди без сети возвращаются в строки', () => {
    const drafts = inputsToDrafts([
      { name: 'Хлеб', price: 99.5, quantity: 2 },
      { name: 'Соль', price: 30 },
    ]);

    expect(drafts.map(({ name, price, quantity }) => ({ name, price, quantity }))).toEqual([
      { name: 'Хлеб', price: '99,5', quantity: '2' },
      { name: 'Соль', price: '30', quantity: '' },
    ]);
    expect(inputsToDrafts(undefined)).toEqual([]);
  });
});

describe('расхождение сумм', () => {
  it('сумма позиций: цена — стоимость строки целиком, округление до копеек', () => {
    expect(sumItems([{ price: 0.1 }, { price: 0.2 }, { price: 12340.2 }])).toBe(12340.5);
  });

  it('меньше суммы операции: спокойная фраза с разницей', () => {
    expect(discrepancyNote(12460.5, 12340.5, 'AMD', 'AMD')).toBe(
      'Сумма позиций 12 340,50, на 120 меньше суммы операции',
    );
  });

  it('больше суммы операции', () => {
    expect(discrepancyNote(100, 130.5, 'USD', 'AMD')).toBe(
      'Сумма позиций 130,50, на 30,50 больше суммы операции',
    );
  });

  it('разница меньше единицы валюты (округление) не показывается', () => {
    expect(discrepancyNote(1000, 999.4, 'AMD', 'AMD')).toBeNull();
    expect(discrepancyNote(1000, 1000, 'USD', 'AMD')).toBeNull();
  });

  it('разница ровно в единицу уже показывается', () => {
    expect(discrepancyNote(1000, 999, 'AMD', 'AMD')).toBe(
      'Сумма позиций 999, на 1 меньше суммы операции',
    );
  });
});

describe('мелкие правила', () => {
  it('«позиция» по-русски', () => {
    expect([1, 2, 3, 4, 5, 11, 12, 21, 22, 25, 100, 101].map(itemsLabel)).toEqual([
      '1 позиция',
      '2 позиции',
      '3 позиции',
      '4 позиции',
      '5 позиций',
      '11 позиций',
      '12 позиций',
      '21 позиция',
      '22 позиции',
      '25 позиций',
      '100 позиций',
      '101 позиция',
    ]);
  });

  it('предпочтение ai.noticeSeen — булево значение, чужие значения отбрасываются', () => {
    expect(sanitizePreferences({ 'ai.noticeSeen': true })).toEqual({ 'ai.noticeSeen': true });
    expect(sanitizePreferences({ 'ai.noticeSeen': 'yes' })).toEqual({});
  });

  it('сообщение об ошибке разбора: мягкая фраза и причина сервера', () => {
    expect(parseFailureMessage(new ApiError(503, 'AI_UNAVAILABLE', 'ИИ временно недоступен'))).toBe(
      'Не удалось разобрать чек, заполните вручную. ИИ временно недоступен',
    );
    expect(parseFailureMessage(new Error('x'))).toBe('Не удалось разобрать чек, заполните вручную');
  });
});

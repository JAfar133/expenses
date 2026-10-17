import { describe, expect, it } from 'vitest';
import {
  categoryForMerchant,
  merchantWords,
} from '../../src/modules/bank-import/merchant-category.ts';

const history = [
  { name: 'Aliexpress', category: 'маркетплейс' },
  { name: 'Urartu', category: 'бытовые расходы' },
  { name: 'Кофе', category: 'кафе' },
];

describe('слова названия магазина', () => {
  it('регистр, знаки и «шум» не важны', () => {
    expect(merchantWords('URARTU ZAQYAN, AM')).toEqual(['urartu', 'zaqyan', 'am']);
    expect(merchantWords('«Urartu» LLC 123')).toEqual(['urartu']);
  });
});

describe('категория по прежним расходам', () => {
  it('то же название: та же категория', () => {
    expect(categoryForMerchant('urartu', history)).toBe('бытовые расходы');
  });

  it('название, в которое входит прежнее: тот же магазин', () => {
    expect(categoryForMerchant('URARTU ZAQYAN', history)).toBe('бытовые расходы');
    expect(categoryForMerchant('ALIEXPRESS.COM', history)).toBe('маркетплейс');
    expect(categoryForMerchant('ALIEXPRESS RU', history)).toBe('маркетплейс');
  });

  it('прежнее длиннее нового: тоже тот же магазин', () => {
    expect(categoryForMerchant('Urartu', [{ name: 'Urartu Zaqyan', category: 'дом' }])).toBe('дом');
  });

  it('точное совпадение важнее частичного, а при равных побеждает более свежий расход', () => {
    const past = [
      { name: 'Urartu Zaqyan', category: 'свежая' },
      { name: 'Urartu', category: 'старая' },
    ];
    expect(categoryForMerchant('URARTU ZAQYAN', past)).toBe('свежая');
    expect(categoryForMerchant('Urartu', past)).toBe('старая');
    expect(
      categoryForMerchant('Urartu Shop X', [
        { name: 'Urartu Shop', category: 'новая' },
        { name: 'Urartu', category: 'прежняя' },
      ]),
    ).toBe('новая');
  });

  it('общее короткое слово не делает магазины одним', () => {
    expect(categoryForMerchant('A MARKET', [{ name: 'A Bakery', category: 'еда' }])).toBe(
      undefined,
    );
    expect(categoryForMerchant('Rest Cafe', [{ name: 'Kafe Rest', category: 'еда' }])).toBe(
      undefined,
    );
  });

  it('разные магазины и пустое название: ничего не находится', () => {
    expect(categoryForMerchant('SAS MARKET', history)).toBe(undefined);
    expect(categoryForMerchant('   ', history)).toBe(undefined);
    expect(categoryForMerchant('Urartu', [])).toBe(undefined);
  });
});

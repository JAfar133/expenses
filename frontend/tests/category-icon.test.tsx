import { describe, expect, it } from 'vitest';
import { categoryIconKey } from '../src/features/budgets/model/category-icon.tsx';

describe('подбор значка категории', () => {
  it.each([
    ['жильё', 'home'],
    ['Аренда квартиры', 'home'],
    ['продукты', 'basket'],
    ['кафе', 'cup'],
    ['Ресторан', 'restaurant'],
    ['транспорт', 'car'],
    ['Такси', 'car'],
    ['одежда', 'shirt'],
    ['здоровье', 'heart'],
    ['маркетплейс', 'cart'],
    ['WB', 'cart'],
    ['снятие наличных', 'cash'],
    ['интернет', 'signal'],
    ['развлечения', 'star'],
    ['подписки', 'document'],
    ['бытовые расходы', 'bulb'],
    ['Коммунальные', 'bulb'],
  ])('«%s» → %s', (name, key) => {
    expect(categoryIconKey(name)).toBe(key);
  });

  it('регистр не важен', () => {
    expect(categoryIconKey('ПРОДУКТЫ')).toBe(categoryIconKey('продукты'));
    expect(categoryIconKey('КаФе')).toBe('cup');
  });

  it('неизвестное название — три точки', () => {
    expect(categoryIconKey('другое')).toBe('other');
    expect(categoryIconKey('')).toBe('other');
    expect(categoryIconKey('xyz')).toBe('other');
  });
});

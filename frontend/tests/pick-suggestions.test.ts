import { describe, expect, it } from 'vitest';
import type { NameSuggestion } from '../src/features/expenses/api/expenses.api.ts';
import { pickSuggestions } from '../src/features/expenses/utils/pick-suggestions.ts';

/** As the server returns them: from most frequent to rarest. */
const all: NameSuggestion[] = [
  { name: 'Латте', category: 'кафе', count: 9 },
  { name: 'Хлеб', category: 'продукты', count: 7 },
  { name: 'Кофе', category: 'кафе', count: 5 },
  { name: 'Кофе', category: 'продукты', count: 6 },
  { name: 'Эспрессо', category: 'кафе', count: 2 },
];

const names = (items: NameSuggestion[]) => items.map((item) => item.name);

describe('pickSuggestions', () => {
  it('с категорией: только её наименования, порядок по частоте сохраняется', () => {
    expect(names(pickSuggestions(all, { category: 'кафе', query: '' }))).toEqual([
      'Латте',
      'Кофе',
      'Эспрессо',
    ]);
  });

  it('пока категория не выбрана, подсказок нет', () => {
    expect(pickSuggestions(all, { category: '', query: '' })).toEqual([]);
  });

  it('фильтрует по введённому тексту без учёта регистра, ищет в любом месте названия', () => {
    expect(names(pickSuggestions(all, { category: 'кафе', query: ' ПРЕ' }))).toEqual(['Эспрессо']);
  });

  it('не предлагает то, что уже введено полностью', () => {
    expect(names(pickSuggestions(all, { category: 'кафе', query: 'латте' }))).toEqual([]);
  });

  it('ограничивает количество', () => {
    expect(pickSuggestions(all, { category: 'кафе', query: '', limit: 2 })).toHaveLength(2);
  });

  it('пустой список даёт пустой результат', () => {
    expect(pickSuggestions([], { category: 'кафе', query: '' })).toEqual([]);
  });
});

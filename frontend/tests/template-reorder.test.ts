import { describe, expect, it } from 'vitest';
import {
  applyOrder,
  clampIndex,
  dropIndex,
  moveItem,
  reorderInSlots,
  shiftOf,
} from '../src/features/templates/model/reorder.ts';
import { previewTemplates, usableTemplates } from '../src/features/templates/model/available.ts';
import type { Template } from '../src/features/templates/api/templates.api.ts';

const t = (id: string, patch: Partial<Template> = {}): Template => ({
  id,
  scope: 'personal',
  pending: false,
  sharedStatus: null,
  name: id,
  emoji: null,
  category: 'кафе',
  card: null,
  effectiveCard: 'Миша',
  author: 'Миша',
  updatedBy: null,
  updatedAt: null,
  expenseName: id,
  amount: 1,
  currency: 'AMD',
  editable: true,
  mine: true,
  hidden: false,
  unavailable: false,
  ...patch,
});

describe('moveItem', () => {
  it('переносит элемент вниз и вверх, не меняя исходный массив', () => {
    const list = ['a', 'b', 'c', 'd'];
    expect(moveItem(list, 0, 2)).toEqual(['b', 'c', 'a', 'd']);
    expect(moveItem(list, 3, 1)).toEqual(['a', 'd', 'b', 'c']);
    expect(list).toEqual(['a', 'b', 'c', 'd']);
  });

  it('индекс за границей прижимается к краю, пустой ход ничего не меняет', () => {
    expect(moveItem(['a', 'b', 'c'], 0, 9)).toEqual(['b', 'c', 'a']);
    expect(moveItem(['a', 'b', 'c'], 1, 1)).toEqual(['a', 'b', 'c']);
    expect(moveItem(['a'], 5, 0)).toEqual(['a']);
  });
});

describe('геометрия перетаскивания', () => {
  const centers = [10, 30, 50, 70];

  it('место сброса считается по центрам остальных строк', () => {
    expect(dropIndex(centers, 0, 10)).toBe(0);
    expect(dropIndex(centers, 0, 55)).toBe(2);
    expect(dropIndex(centers, 3, 20)).toBe(1);
    expect(dropIndex(centers, 3, 5)).toBe(0);
  });

  it('соседи сдвигаются, освобождая место', () => {
    expect(shiftOf(1, 0, 2, 20)).toBe(-20);
    expect(shiftOf(2, 0, 2, 20)).toBe(-20);
    expect(shiftOf(3, 0, 2, 20)).toBe(0);
    expect(shiftOf(1, 3, 1, 20)).toBe(20);
    expect(shiftOf(0, 3, 1, 20)).toBe(0);
  });

  it('границы прижимают индекс', () => {
    expect(clampIndex(0, [2, 4])).toBe(2);
    expect(clampIndex(9, [2, 4])).toBe(4);
    expect(clampIndex(3, [2, 4])).toBe(3);
  });
});

describe('reorderInSlots', () => {
  it('переставленная часть возвращается на свои места, остальные стоят как стояли', () => {
    const full = [t('a'), t('x'), t('b'), t('y'), t('c')];
    const ordered = [t('c'), t('a'), t('b')];
    expect(reorderInSlots(full, ordered).map((item) => item.id)).toEqual(['c', 'x', 'a', 'y', 'b']);
  });
});

describe('приоритет шаблонов', () => {
  it('порядок тот, что прислал сервер: группа и личные вперемешку', () => {
    const list = [t('p1'), t('g1', { scope: 'group' }), t('p2'), t('g2', { scope: 'group' })];
    expect(usableTemplates(list, false).map((item) => item.id)).toEqual(['p1', 'g1', 'p2', 'g2']);
  });

  it('скрытые, с архивной категорией и дубли уходят в хвост с причиной', () => {
    const list = [
      t('g1', { scope: 'group', hidden: true }),
      t('p1', { unavailable: true }),
      t('p2'),
      t('g2', { scope: 'group', name: 'X', expenseName: 'X' }),
      t('p3', { name: 'X', expenseName: 'X', sharedStatus: 'active' }),
    ];
    const { shown, tail } = previewTemplates(list, false);
    expect(shown.map((item) => item.id)).toEqual(['p2', 'g2']);
    expect(tail.map((item) => [item.template.id, item.reason])).toEqual([
      ['g1', 'скрыт вами'],
      ['p1', 'категория в архиве'],
      ['p3', 'заменён групповым'],
    ]);
  });

  it('«скрыть все групповые»: групповые в хвосте, личный дубль возвращается', () => {
    const list = [
      t('g1', { scope: 'group', name: 'X', expenseName: 'X' }),
      t('p1', { name: 'X', expenseName: 'X', sharedStatus: 'active' }),
    ];
    const { shown, tail } = previewTemplates(list, true);
    expect(shown.map((item) => item.id)).toEqual(['p1']);
    expect(tail[0]?.reason).toBe('скрыты все групповые');
  });
});

describe('applyOrder', () => {
  it('ставит список в порядок ids, не упомянутое остаётся в конце', () => {
    const list = [t('a'), t('b'), t('p', { pending: true }), t('c')];
    expect(applyOrder(list, ['c', 'a', 'b']).map((item) => item.id)).toEqual(['c', 'a', 'b', 'p']);
  });
});

import { describe, expect, it } from 'vitest';
import { reconcile } from '../../src/modules/sync/reconcile.ts';
import type { Expense, ExcelStatus, StoredExpense } from '../../src/storage/expense.repository.ts';

const coffee: Expense = {
  date: '2026-10-10',
  card: 'Миша',
  category: 'кафе',
  name: 'Кофе',
  amount: 640,
};
const bread: Expense = { ...coffee, name: 'Хлеб', category: 'продукты', amount: 300 };

let nextId = 0;
const stored = (expense: Expense, excelStatus: ExcelStatus): StoredExpense => ({
  ...expense,
  id: `id-${++nextId}`,
  source: 'app',
  excelStatus,
});

describe('новые строки в Excel', () => {
  it('все строки Excel импортируются, если БД пуста', () => {
    const plan = reconcile([coffee, bread], []);

    expect(plan.toImport).toEqual([coffee, bread]);
    expect(plan).toMatchObject({ promoteToSynced: [], revertToPending: [], diverged: 0 });
  });

  it('уже известные строки не импортируются повторно', () => {
    const plan = reconcile([coffee, bread], [stored(coffee, 'synced'), stored(bread, 'synced')]);

    expect(plan).toEqual({ toImport: [], promoteToSynced: [], revertToPending: [], diverged: 0 });
  });

  it('импортируется только новое', () => {
    const plan = reconcile([coffee, bread], [stored(coffee, 'synced')]);

    expect(plan.toImport).toEqual([bread]);
  });
});

describe('одинаковые операции', () => {
  it('настоящие дубликаты не склеиваются: 3 в Excel и 1 в БД — импортируем 2', () => {
    const plan = reconcile([coffee, coffee, coffee], [stored(coffee, 'synced')]);

    expect(plan.toImport).toEqual([coffee, coffee]);
  });

  it('идемпотентность: после импорта повторная сверка ничего не меняет', () => {
    const first = reconcile([coffee, coffee], []);
    const db = first.toImport.map((e) => stored(e, 'synced'));

    expect(reconcile([coffee, coffee], db).toImport).toEqual([]);
  });
});

describe('очередь (pending)', () => {
  it('записи в очереди не влияют на сверку', () => {
    const plan = reconcile([bread], [stored(coffee, 'pending')]);

    expect(plan.toImport).toEqual([bread]);
    expect(plan.diverged).toBe(0);
  });

  it('такая же операция, добавленная вручную в Excel, — это отдельный расход', () => {
    const plan = reconcile([coffee], [stored(coffee, 'pending')]);

    expect(plan.toImport).toEqual([coffee]);
  });
});

describe('незавершённая запись (writing)', () => {
  it('если строка есть в Excel — запись состоялась, помечаем synced и не дублируем', () => {
    const writing = stored(coffee, 'writing');

    const plan = reconcile([coffee], [writing]);

    expect(plan).toEqual({
      toImport: [],
      promoteToSynced: [writing.id],
      revertToPending: [],
      diverged: 0,
    });
  });

  it('если строки в Excel нет — возвращаем в очередь', () => {
    const writing = stored(coffee, 'writing');

    const plan = reconcile([], [writing]);

    expect(plan.revertToPending).toEqual([writing.id]);
    expect(plan.toImport).toEqual([]);
  });

  it('две одинаковые writing-записи, а в Excel одна: одна записана, вторая в очередь', () => {
    const [a, b] = [stored(coffee, 'writing'), stored(coffee, 'writing')];

    const plan = reconcile([coffee], [a, b]);

    expect(plan.promoteToSynced).toEqual([a.id]);
    expect(plan.revertToPending).toEqual([b.id]);
  });

  it('лишняя строка Excel сверх writing импортируется как новая', () => {
    const writing = stored(coffee, 'writing');

    const plan = reconcile([coffee, coffee], [writing]);

    expect(plan.promoteToSynced).toEqual([writing.id]);
    expect(plan.toImport).toEqual([coffee]);
  });
});

describe('расхождения', () => {
  it('строка удалена в Excel: считаем расхождением, из БД не удаляем', () => {
    const plan = reconcile([], [stored(coffee, 'synced')]);

    expect(plan.diverged).toBe(1);
    expect(plan.toImport).toEqual([]);
  });

  it('строка изменена в Excel: новая версия импортируется, старая — расхождение', () => {
    const edited = { ...coffee, amount: 700 };

    const plan = reconcile([edited], [stored(coffee, 'synced')]);

    expect(plan.toImport).toEqual([edited]);
    expect(plan.diverged).toBe(1);
  });

  it('удалён один из двух одинаковых расходов', () => {
    const plan = reconcile([coffee], [stored(coffee, 'synced'), stored(coffee, 'synced')]);

    expect(plan.diverged).toBe(1);
  });
});

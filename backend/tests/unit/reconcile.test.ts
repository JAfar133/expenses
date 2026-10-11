import { describe, expect, it } from 'vitest';
import { isMassDeletion, reconcile } from '../../src/modules/sync/reconcile.ts';
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
const stored = (
  expense: Expense,
  excelStatus: ExcelStatus,
  deletedAt: string | null = null,
): StoredExpense => ({ ...expense, id: `id-${++nextId}`, source: 'app', excelStatus, deletedAt });

const EMPTY = {
  toImport: [],
  promoteToSynced: [],
  revertToPending: [],
  toDelete: [],
  toRestore: [],
};

describe('новые строки в Excel', () => {
  it('все строки Excel импортируются, если БД пуста', () => {
    const plan = reconcile([coffee, bread], []);

    expect(plan).toEqual({ ...EMPTY, toImport: [coffee, bread] });
  });

  it('уже известные строки не импортируются повторно', () => {
    const plan = reconcile([coffee, bread], [stored(coffee, 'synced'), stored(bread, 'synced')]);

    expect(plan).toEqual(EMPTY);
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

    expect(reconcile([coffee, coffee], db)).toEqual(EMPTY);
  });
});

describe('очередь (pending)', () => {
  it('записи в очереди не влияют на сверку и не удаляются', () => {
    const plan = reconcile([bread], [stored(coffee, 'pending')]);

    expect(plan).toEqual({ ...EMPTY, toImport: [bread] });
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

    expect(plan).toEqual({ ...EMPTY, promoteToSynced: [writing.id] });
  });

  it('если строки в Excel нет — возвращаем в очередь, а не удаляем', () => {
    const writing = stored(coffee, 'writing');

    const plan = reconcile([], [writing]);

    expect(plan).toEqual({ ...EMPTY, revertToPending: [writing.id] });
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

describe('мягкое удаление: строки пропали из Excel', () => {
  it('удалённая в Excel строка помечается на удаление, а не стирается', () => {
    const row = stored(coffee, 'synced');

    const plan = reconcile([], [row]);

    expect(plan).toEqual({ ...EMPTY, toDelete: [row.id] });
  });

  it('изменённая строка: старая версия удаляется, новая импортируется', () => {
    const old = stored(coffee, 'synced');
    const edited = { ...coffee, amount: 700 };

    const plan = reconcile([edited], [old]);

    expect(plan.toDelete).toEqual([old.id]);
    expect(plan.toImport).toEqual([edited]);
  });

  it('удалён один из двух одинаковых расходов: удаляется самый новый', () => {
    const [older, newer] = [stored(coffee, 'synced'), stored(coffee, 'synced')];

    const plan = reconcile([coffee], [older, newer]);

    expect(plan.toDelete).toEqual([newer.id]);
  });

  it('строки Excel в другом порядке ничего не меняют', () => {
    const [a, b] = [stored(coffee, 'synced'), stored(bread, 'synced')];

    expect(reconcile([bread, coffee], [a, b])).toEqual(EMPTY);
  });

  it('уже удалённые записи повторно не удаляются', () => {
    const gone = stored(coffee, 'synced', '2026-10-10T10:00:00.000Z');

    const plan = reconcile([], [gone]);

    expect(plan).toEqual(EMPTY);
  });
});

describe('мягкое удаление: строки вернулись в Excel', () => {
  it('удалённая запись восстанавливается, а не создаётся заново', () => {
    const gone = stored(coffee, 'synced', '2026-10-10T10:00:00.000Z');

    const plan = reconcile([coffee], [gone]);

    expect(plan).toEqual({ ...EMPTY, toRestore: [gone.id] });
  });

  it('если вернулось больше строк, чем было удалено, остальное импортируется', () => {
    const gone = stored(coffee, 'synced', '2026-10-10T10:00:00.000Z');

    const plan = reconcile([coffee, coffee], [gone]);

    expect(plan.toRestore).toEqual([gone.id]);
    expect(plan.toImport).toEqual([coffee]);
  });

  it('из нескольких удалённых восстанавливается самая недавно удалённая', () => {
    const early = stored(coffee, 'synced', '2026-10-01T10:00:00.000Z');
    const late = stored(coffee, 'synced', '2026-10-09T10:00:00.000Z');

    const plan = reconcile([coffee], [early, late]);

    expect(plan.toRestore).toEqual([late.id]);
  });

  it('writing-запись получает приоритет перед восстановлением удалённой', () => {
    const writing = stored(coffee, 'writing');
    const gone = stored(coffee, 'synced', '2026-10-10T10:00:00.000Z');

    const plan = reconcile([coffee], [writing, gone]);

    expect(plan.promoteToSynced).toEqual([writing.id]);
    expect(plan.toRestore).toEqual([]);
  });
});

describe('isMassDeletion: защита от массовой потери', () => {
  const guard = (toDelete: number, activeSynced: number, excelRows: number, maxPercent = 25) =>
    isMassDeletion({ toDelete, activeSynced, excelRows, maxPercent });

  it.each([
    ['нечего удалять', 0, 100, 100, false],
    ['мало записей: порог не применяется', 4, 5, 1, false],
    ['10% — обычная работа', 10, 100, 90, false],
    ['ровно 25% — допустимо', 25, 100, 75, false],
    ['26% — слишком много', 26, 100, 74, true],
    ['половина записей', 50, 100, 50, true],
  ])('%s', (_name, toDelete, activeSynced, excelRows, expected) => {
    expect(guard(toDelete, activeSynced, excelRows)).toBe(expected);
  });

  it('пустой Excel при непустой базе блокируется даже для одной записи', () => {
    expect(guard(1, 1, 0)).toBe(true);
    expect(guard(3, 3, 0)).toBe(true);
  });

  it('пустой Excel и пустая база — не массовое удаление', () => {
    expect(guard(0, 0, 0)).toBe(false);
  });

  it('порог настраивается', () => {
    expect(guard(30, 100, 70, 50)).toBe(false);
    expect(guard(60, 100, 40, 50)).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';
import { planReceipt, type CurrentExpense } from '../../src/modules/expense-ai/plan-receipt.ts';
import { withSources } from '../../src/modules/items/keep-source.ts';
import { parseReceiptAnswer, receiptRequest } from '../../src/modules/llm/receipt-parser.ts';
import { SecretBox } from '../../src/modules/llm/secret-box.ts';

const TODAY = '2026-10-15';
const current = (overrides: Partial<CurrentExpense> = {}): CurrentExpense => ({
  name: 'Чек',
  nameSource: 'default',
  date: TODAY,
  dateSource: 'default',
  items: [],
  ...overrides,
});
const receipt = {
  name: 'Shop',
  date: '2026-10-10',
  items: [{ name: 'a', price: 1, quantity: 1 }],
  dropped: 0,
};

describe('шифрование ключа', () => {
  it('расшифровывает тем же мастер-ключом и не расшифровывает другим', () => {
    const box = new SecretBox('мастер-ключ-мастер-ключ-мастер-ключ');
    const stored = box.encrypt('AIza-key');

    expect(stored).not.toContain('AIza-key');
    expect(box.decrypt(stored)).toBe('AIza-key');
    expect(new SecretBox('другой-мастер-ключ-другой-мастер').decrypt(stored)).toBeUndefined();
  });

  it('без мастер-ключа сохранить нельзя', () => {
    expect(() => new SecretBox(undefined).encrypt('x')).toThrowError(/SECRETS_KEY/);
  });

  it('повреждённое значение даёт undefined, а не ошибку', () => {
    expect(
      new SecretBox('мастер-ключ-мастер-ключ-мастер-ключ').decrypt('v1:aa:bb:cc'),
    ).toBeUndefined();
  });
});

describe('что разбор чека может менять', () => {
  it('значения по умолчанию и прежние значения ИИ заменяются, ручные нет', () => {
    const options = { today: TODAY, replaceItems: false };

    expect(planReceipt(current(), receipt, options)).toMatchObject({
      name: 'Shop',
      date: '2026-10-10',
    });
    expect(
      planReceipt(current({ nameSource: 'ai', dateSource: 'ai' }), receipt, options),
    ).toMatchObject({
      name: 'Shop',
      date: '2026-10-10',
    });
    const manual = planReceipt(
      current({ nameSource: 'manual', dateSource: 'manual' }),
      receipt,
      options,
    );
    expect(manual.name).toBeUndefined();
    expect(manual.date).toBeUndefined();
  });

  it('позиции: ручные не заменяются без просьбы', () => {
    const own = current({ items: [{ source: 'manual' }, { source: 'ai' }] });

    expect(planReceipt(own, receipt, { today: TODAY, replaceItems: false })).toMatchObject({
      itemsKept: true,
    });
    expect(planReceipt(own, receipt, { today: TODAY, replaceItems: true }).items).toHaveLength(1);
    expect(
      planReceipt(current({ items: [{ source: 'ai' }] }), receipt, {
        today: TODAY,
        replaceItems: false,
      }).items,
    ).toHaveLength(1);
  });

  it('пустой список позиций ничего не заменяет', () => {
    const plan = planReceipt(
      current({ items: [{ source: 'manual' }] }),
      { ...receipt, items: [] },
      { today: TODAY, replaceItems: true },
    );

    expect(plan.items).toBeUndefined();
  });

  it('границы даты: сегодня можно, год назад можно, 367 дней назад нет, завтра нет', () => {
    const options = { today: TODAY, replaceItems: false };
    const dateFor = (date: string) =>
      planReceipt(current({ date: '2026-01-01' }), { ...receipt, date }, options).date;

    expect(dateFor('2026-10-15')).toBe('2026-10-15');
    expect(dateFor('2025-10-14')).toBe('2025-10-14');
    expect(dateFor('2025-10-13')).toBeUndefined();
    expect(dateFor('2026-10-16')).toBeUndefined();
  });
});

describe('ответ модели', () => {
  it('приводит числа к двум и трём знакам, количество по умолчанию 1, обрезает пробелы', () => {
    const parsed = parseReceiptAnswer({
      name: '  Shop ',
      date: '2026-10-10',
      total: 10.456,
      items: [
        { name: ' Сок ', price: 10.456, quantity: null },
        { name: 'Мясо', price: 5, quantity: 0.12345 },
      ],
    });

    expect(parsed.name).toBe('Shop');
    expect(parsed.items).toEqual([
      { name: 'Сок', price: 10.46, quantity: 1 },
      { name: 'Мясо', price: 5, quantity: 0.123 },
    ]);
  });

  it('больше ста позиций обрезается, лишнее считается отброшенным', () => {
    const items = Array.from({ length: 120 }, (_, index) => ({ name: `п${index}`, price: 1 }));

    const parsed = parseReceiptAnswer({ items });

    expect(parsed.items).toHaveLength(100);
    expect(parsed.dropped).toBe(20);
  });

  it('не объект или items не список: ответ отвергается целиком', () => {
    expect(() => parseReceiptAnswer('текст')).toThrowError();
    expect(() => parseReceiptAnswer({ items: 5 })).toThrowError();
  });

  it('нечитаемая дата просто не используется', () => {
    expect(parseReceiptAnswer({ date: '12 октября', items: [] }).date).toBeUndefined();
  });
});

describe('метки позиций', () => {
  const existing = [
    { id: 'a', position: 0, name: 'Хлеб', price: 10, quantity: 1, source: 'ai' as const },
  ];

  it('метка ИИ сохраняется только у неизменённой позиции с тем же id', () => {
    expect(
      withSources([{ id: 'a', name: 'Хлеб', price: 10, quantity: 1 }], existing)[0]!.source,
    ).toBe('ai');
    expect(
      withSources([{ id: 'a', name: 'Хлеб', price: 11, quantity: 1 }], existing)[0]!.source,
    ).toBe('manual');
    expect(withSources([{ name: 'Хлеб', price: 10, quantity: 1 }], existing)[0]!.source).toBe(
      'manual',
    );
  });
});

describe('запрос к модели', () => {
  const image = { bytes: Buffer.from('x'), contentType: 'image/jpeg' };

  it('передаёт сегодняшнюю дату', () => {
    expect(receiptRequest(image, '2026-10-15').prompt).toContain('Today is 2026-10-15');
  });

  it('язык названий зависит от разрешённых языков группы', () => {
    const prompt = (languages: ('en' | 'ru')[]) =>
      receiptRequest(image, '2026-10-15', [], languages).prompt;

    expect(prompt(['en'])).toContain('Write ALL text values in English');
    expect(prompt(['ru'])).toContain('Write ALL text values in Russian');
    expect(prompt(['ru'])).toContain('Cyrillic');
    const both = prompt(['en', 'ru']);
    expect(both).toContain('in the language of the receipt when it is English or Russian');
    expect(both).toContain('translate product and dish names to English');
  });
});

describe('категория в ответе модели', () => {
  it('принимается только точное название из предложенных', () => {
    const offered = ['кафе', 'продукты'];

    expect(parseReceiptAnswer({ items: [], category: 'кафе' }, offered).category).toBe('кафе');
    expect(parseReceiptAnswer({ items: [], category: 'Кафе' }, offered).category).toBeUndefined();
    expect(parseReceiptAnswer({ items: [], category: 'кафе' }).category).toBeUndefined();
    expect(parseReceiptAnswer({ items: [], category: null }, offered).category).toBeUndefined();
  });

  it('просит категорию только когда есть из чего выбирать', () => {
    const image = { bytes: Buffer.from('x'), contentType: 'image/jpeg' };

    expect((receiptRequest(image, '2026-10-15').schema as any).properties.category).toBeUndefined();
    const withCategories = receiptRequest(image, '2026-10-15', ['кафе']);
    expect((withCategories.schema as any).properties.category.enum).toEqual(['кафе']);
    expect(withCategories.prompt).toContain('"кафе"');
  });
});

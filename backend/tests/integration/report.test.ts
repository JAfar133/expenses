import ExcelJS from 'exceljs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Database } from '../../src/infrastructure/database/database.ts';
import { createTestApp, type TestApp } from '../helpers/create-test-app.ts';
import { createTestDatabase } from '../helpers/test-database.ts';

/** The Excel report: what is in the file, the rights, the filters, the limit. */
let database: Database;
let t: TestApp;

const call = (
  method: 'GET' | 'POST' | 'PATCH',
  url: string,
  as = 'misha',
  payload?: unknown,
  headers: Record<string, string> = {},
) =>
  t.inject(
    { method, url, headers, ...(payload === undefined ? {} : { payload: payload as object }) },
    as,
  );

let key = 0;
const spend = (
  card: string,
  name: string,
  amount: number,
  extra: Record<string, unknown> = {},
  as = 'misha',
) =>
  call(
    'POST',
    '/api/expenses',
    as,
    { date: '2026-10-10', card, category: 'кафе', name, amount, ...extra },
    { 'idempotency-key': `report-key-${++key}-xxxxxxxx` },
  );

async function download(query = '', as = 'misha') {
  const response = await t.app.inject({
    method: 'GET',
    url: `/api/expenses/export.xlsx${query}`,
    cookies: await t.sessionCookies(as),
    headers: { origin: 'http://localhost' },
  });
  return response;
}
async function workbookOf(query = '', as = 'misha') {
  const response = await download(query, as);
  expect(response.statusCode).toBe(200);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(response.rawPayload as unknown as ExcelJS.Buffer);
  return workbook;
}
const rowValues = (sheet: ExcelJS.Worksheet, row: number) =>
  (sheet.getRow(row).values as unknown[]).slice(1);

beforeAll(async () => {
  database = await createTestDatabase();
});
afterAll(() => database.close());

beforeEach(async () => {
  await database.exec(
    'DELETE FROM expenses; DELETE FROM exchange_rate_history; DELETE FROM invitations; DELETE FROM auth_sessions; DELETE FROM card_access; DELETE FROM memberships; DELETE FROM cards; DELETE FROM categories; DELETE FROM groups; DELETE FROM users',
  );
  t = await createTestApp(database, { maxReportRows: 5 });
  t.rates.rates.set('USD', 380);
  t.rates.rates.set('RUB', 4.2997);
});

describe('файл отчёта', () => {
  it('скачивается как xlsx с понятным именем', async () => {
    await spend('Миша', 'Кофе', 500);

    const response = await download();

    expect(response.headers['content-type']).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    expect(response.headers['content-disposition']).toContain('attachment');
    expect(decodeURIComponent(String(response.headers['content-disposition']))).toMatch(
      /расходы-\d{4}-\d{2}-\d{2}\.xlsx/,
    );
    expect(response.headers['cache-control']).toBe('no-store');
  });

  it('три листа: операции, по месяцам, по категориям', async () => {
    await spend('Миша', 'Кофе', 500);

    const workbook = await workbookOf();

    expect(workbook.worksheets.map((w) => w.name)).toEqual([
      'Операции',
      'По месяцам',
      'По категориям',
    ]);
  });

  it('лист «Операции»: первые пять колонок как в старой таблице, затем валюты, введённое, курс', async () => {
    await spend('Миша', 'Кофе', 500);
    await spend('Миша', 'Шорты', 5000, { currency: 'RUB', category: 'продукты' });

    const sheet = (await workbookOf()).getWorksheet('Операции')!;

    expect(rowValues(sheet, 5)).toEqual([
      'дата',
      'карта',
      'категория',
      'наименование',
      'стоимость',
      'валюта карты',
      'сумма в валюте карты',
      'введено',
      'курс',
      'сумма, AMD',
      'добавил',
    ]);
    const [
      date,
      card,
      category,
      name,
      drams,
      cardCurrency,
      cardAmount,
      entered,
      rate,
      amount,
      author,
    ] = rowValues(sheet, 7);
    expect([
      card,
      category,
      name,
      drams,
      cardCurrency,
      cardAmount,
      entered,
      rate,
      amount,
      author,
    ]).toEqual([
      'Миша',
      'продукты',
      'Шорты',
      21498,
      'AMD',
      21498,
      '5000 RUB',
      4.2997,
      21498,
      'Миша',
    ]);
    expect(date).toBeInstanceOf(Date);
    expect((date as Date).toISOString().slice(0, 10)).toBe('2026-10-10');
    expect(sheet.getCell(7, 1).numFmt).toBe('dd.mm.yyyy');
    expect(sheet.getCell(7, 5).numFmt).toBe('#,##0');
  });

  it('есть строка итогов с формулой SUM, а над таблицей описание периода и фильтров', async () => {
    await spend('Миша', 'Кофе', 500);
    await spend('Миша', 'Чай', 300);

    const sheet = (await workbookOf('?categories=кафе')).getWorksheet('Операции')!;

    expect(String(sheet.getCell('A1').value)).toContain('Расходы');
    expect(String(sheet.getCell('A2').value)).toBe('Фильтры: категории: кафе');
    expect(String(sheet.getCell('A3').value)).toContain('Суммы в AMD');
    expect(sheet.getCell(8, 1).value).toBe('Итого');
    expect(sheet.getTable('Операции')).toBeDefined();
  });

  it('суммы в выбранной валюте: на карте в долларах в долларах точная сумма, формат с копейками', async () => {
    await call('POST', '/api/group/cards', 'misha', { name: 'Доллары', currency: 'USD' });
    await spend('Доллары', 'Кофе', 10.5);

    const sheet = (await workbookOf('?currency=USD')).getWorksheet('Операции')!;

    const row = rowValues(sheet, 6);
    expect(row[5]).toBe('USD');
    expect(row[6]).toBe(10.5);
    expect(row[9]).toBe(10.5);
    expect(sheet.getCell(6, 10).numFmt).toBe('#,##0.00');
    expect(rowValues(sheet, 5)[9]).toBe('сумма, USD');
  });

  it('текст, начинающийся с «=», остаётся текстом, а не формулой', async () => {
    await spend('Миша', '=HYPERLINK("http://x")', 500);

    const sheet = (await workbookOf()).getWorksheet('Операции')!;

    expect(sheet.getCell(6, 4).value).toBe('=HYPERLINK("http://x")');
    expect(sheet.getCell(6, 4).type).toBe(ExcelJS.ValueType.String);
  });

  it('листы итогов: месяцы и категории с картами', async () => {
    await spend('Миша', 'Кофе', 500);
    await spend('Миша', 'Платье', 1500, { category: 'продукты' });
    await spend('Настя', 'Чай', 1000, {}, 'nastya');

    const workbook = await workbookOf();
    const months = workbook.getWorksheet('По месяцам')!;
    const breakdown = workbook.getWorksheet('По категориям')!;

    expect(rowValues(months, 5).slice(0, 3)).toEqual(['месяц', 'операций', 'сумма, AMD']);
    expect(rowValues(months, 6).slice(1, 3)).toEqual([3, 3000]);
    expect(rowValues(breakdown, 5)).toEqual(['категория', 'операций', 'сумма, AMD', 'доля']);
    expect(rowValues(breakdown, 6)).toEqual(['кафе', 2, 1500, 0.5]);
    expect(rowValues(breakdown, 7)).toEqual(['продукты', 1, 1500, 0.5]);
    // The second table is the cards
    expect(rowValues(breakdown, 11)[0]).toBe('карта');
  });
});

describe('права и фильтры', () => {
  it('участник получает только траты своих карт', async () => {
    await spend('Миша', 'Моя', 500);
    await spend('Настя', 'Чужая для миши', 900, {}, 'nastya');
    await database.query(
      "DELETE FROM card_access WHERE card_id = (SELECT id FROM cards WHERE name = 'Миша')",
    );

    const sheet = (await workbookOf('', 'nastya')).getWorksheet('Операции')!;

    const names = [6, 7].map((row) => rowValues(sheet, row)[3]);
    expect(names).toContain('Чужая для миши');
    expect(names).not.toContain('Моя');
  });

  it('фильтры и период берутся те же, что у списка', async () => {
    await spend('Миша', 'Октябрьская', 500);
    await spend('Миша', 'Сентябрьская', 700, { date: '2026-09-10' });

    const sheet = (await workbookOf('?from=2026-10-01&to=2026-10-31')).getWorksheet('Операции')!;

    expect(rowValues(sheet, 6)[3]).toBe('Октябрьская');
    expect(sheet.getCell(7, 1).value).toBe('Итого');
  });

  it('если операций нет, в файле понятная заметка вместо таблицы', async () => {
    const sheet = (await workbookOf('?q=нет такого')).getWorksheet('Операции')!;

    expect(sheet.getCell('A5').value).toBe('По выбранным фильтрам операций нет');
  });

  it('слишком большой отчёт отклоняется с понятной ошибкой', async () => {
    for (let i = 0; i < 6; i++) await spend('Миша', `Трата ${i}`, 100 + i);

    const response = await download();

    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe('EXPORT_TOO_LARGE');
  });

  it('валюта вне списка отклоняется, без входа 401', async () => {
    expect((await download('?currency=XXX')).statusCode).toBe(422);
    const anonymous = await t.app.inject({ method: 'GET', url: '/api/expenses/export.xlsx' });
    expect(anonymous.statusCode).toBe(401);
  });
});

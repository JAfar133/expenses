import ExcelJS from 'exceljs';
import { AppError } from '../../errors/app-error.ts';
import type { AnalyticsService } from '../analytics/analytics.service.ts';
import type { AnalyticsFilters, ExpenseListItem } from '../analytics/analytics.types.ts';
import { describeFilters, periodText } from './filter-note.ts';

const DEFAULT_MAX_ROWS = 50_000;

export interface ReportOptions {
  /** How many operations a report may hold */
  maxRows?: number;
  /** The currency of the drams amount (rates are quoted against it) */
  base: string;
}

export interface ReportContext {
  /** The currency of the "сумма" columns and of the summary sheets */
  currency: string;
  /** Today in the user's time zone (YYYY-MM-DD), for the head of the file */
  today: string;
}

const tooLarge = (count: number, max: number) =>
  new AppError(
    422,
    'EXPORT_TOO_LARGE',
    `В отчёт попадает ${count} операций, а можно не больше ${max}. Сузьте период или фильтры`,
  );

/** A table column; `totalsRowResult` (the shown value of the totals formula) exists in ExcelJS but not in its typings. */
type Column = ExcelJS.TableColumnProperties & { totalsRowResult?: number };

const tableColumns = (columns: Column[]) => columns as ExcelJS.TableColumnProperties[];

const NUMBER_FORMAT = { whole: '#,##0', cents: '#,##0.00', rate: '0.0000', share: '0.0%' };

/** The Excel report: operations, totals by month and by category/card. Built from the same filters and rights as the lists. */
export class ReportService {
  private readonly maxRows: number;

  constructor(
    private readonly analytics: Pick<
      AnalyticsService,
      'list' | 'timeseries' | 'breakdown' | 'authors'
    >,
    private readonly options: ReportOptions,
  ) {
    this.maxRows = options.maxRows ?? DEFAULT_MAX_ROWS;
  }

  async build(filters: AnalyticsFilters, context: ReportContext): Promise<Buffer> {
    const page = await this.analytics.list(filters, {
      sort: 'date',
      direction: 'asc',
      limit: this.maxRows,
      offset: 0,
    });
    if (page.total > this.maxRows) throw tooLarge(page.total, this.maxRows);

    const [months, categories, cards, authors] = await Promise.all([
      this.analytics.timeseries(filters, 'month', undefined, 'UTC'),
      this.analytics.breakdown(filters, 'category', 500),
      this.analytics.breakdown(filters, 'card', 200),
      this.analytics.authors(filters.scope),
    ]);
    const authorLabels = new Map(authors.map((author) => [author.value, author.label]));
    const head = [
      `Расходы, ${periodText(filters)}`,
      describeFilters(filters, authorLabels),
      `Суммы в ${context.currency}. Сформировано ${context.today}`,
    ];

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Расходы';
    workbook.created = new Date();

    this.operationsSheet(workbook, page.items, authorLabels, head, context);
    this.monthsSheet(workbook, months, head, context);
    this.breakdownSheet(workbook, categories, cards, head, context);

    return Buffer.from(await workbook.xlsx.writeBuffer());
  }

  private writeHead(sheet: ExcelJS.Worksheet, head: string[]): void {
    sheet.getCell('A1').value = head[0]!;
    sheet.getCell('A1').font = { bold: true, size: 14 };
    sheet.getCell('A2').value = head[1]!;
    sheet.getCell('A3').value = head[2]!;
    for (const row of [2, 3]) sheet.getCell(`A${row}`).font = { color: { argb: 'FF666666' } };
  }

  private operationsSheet(
    workbook: ExcelJS.Workbook,
    items: ExpenseListItem[],
    authorLabels: Map<string, string>,
    head: string[],
    { currency }: ReportContext,
  ): void {
    const sheet = workbook.addWorksheet('Операции');
    this.writeHead(sheet, head);
    const widths = [12, 14, 16, 34, 14, 10, 16, 18, 10, 18, 16];
    widths.forEach((width, index) => (sheet.getColumn(index + 1).width = width));

    if (items.length === 0) {
      sheet.getCell('A5').value = 'По выбранным фильтрам операций нет';
      return;
    }

    const sumOf = (pick: (item: ExpenseListItem) => number) =>
      items.reduce((total, item) => total + pick(item), 0);
    const columns: Column[] = [
      { name: 'дата', totalsRowLabel: 'Итого', filterButton: true },
      { name: 'карта', filterButton: true },
      { name: 'категория', filterButton: true },
      { name: 'наименование', filterButton: true },
      {
        name: 'стоимость',
        filterButton: true,
        totalsRowFunction: 'sum',
        totalsRowResult: sumOf((item) => item.dramsAmount),
      },
      { name: 'валюта карты', filterButton: true },
      { name: 'сумма в валюте карты', filterButton: true },
      { name: 'введено', filterButton: true },
      { name: 'курс', filterButton: true },
      {
        name: `сумма, ${currency}`,
        filterButton: true,
        totalsRowFunction: 'sum',
        totalsRowResult: sumOf((item) => item.displayAmount),
      },
      { name: 'добавил', filterButton: true },
    ];
    const rows = items.map((item) => [
      new Date(`${item.date}T00:00:00Z`),
      item.card,
      item.category,
      item.name,
      item.dramsAmount,
      item.currency,
      item.amount,
      item.original ? `${item.original.amount} ${item.original.currency}` : '',
      item.original ? item.original.rate : null,
      item.displayAmount,
      authorLabels.get(item.createdBy) ?? item.createdBy,
    ]);

    const table = sheet.addTable({
      name: 'Операции',
      ref: 'A5',
      headerRow: true,
      totalsRow: true,
      style: { theme: 'TableStyleMedium2', showRowStripes: true },
      columns: tableColumns(columns),
      rows,
    });
    table.commit();

    // Every currency can have cents, drams included
    const decimals = (_code: string) => NUMBER_FORMAT.cents;
    items.forEach((item, index) => {
      const row = 6 + index;
      sheet.getCell(row, 1).numFmt = 'dd.mm.yyyy';
      sheet.getCell(row, 5).numFmt = NUMBER_FORMAT.whole;
      sheet.getCell(row, 7).numFmt = decimals(item.currency);
      sheet.getCell(row, 9).numFmt = NUMBER_FORMAT.rate;
      sheet.getCell(row, 10).numFmt = decimals(currency);
    });
    const totalRow = 6 + items.length;
    sheet.getCell(totalRow, 5).numFmt = NUMBER_FORMAT.whole;
    sheet.getCell(totalRow, 10).numFmt = decimals(currency);
    sheet.views = [{ state: 'frozen', ySplit: 5 }];
  }

  private monthsSheet(
    workbook: ExcelJS.Workbook,
    months: { period: string; total: number; count: number }[],
    head: string[],
    { currency }: ReportContext,
  ): void {
    const sheet = workbook.addWorksheet('По месяцам');
    this.writeHead(sheet, head);
    [16, 12, 18, 18, 22].forEach((width, index) => (sheet.getColumn(index + 1).width = width));
    const used = months.filter((point) => point.count > 0);
    if (used.length === 0) {
      sheet.getCell('A5').value = 'Нет данных';
      return;
    }

    const rows = used.map((point, index) => {
      const previous = index > 0 ? used[index - 1]!.total : 0;
      return [
        new Date(`${point.period}T00:00:00Z`),
        point.count,
        point.total,
        point.total / point.count,
        previous > 0 ? point.total / previous - 1 : null,
      ];
    });
    const table = sheet.addTable({
      name: 'Месяцы',
      ref: 'A5',
      headerRow: true,
      totalsRow: true,
      style: { theme: 'TableStyleMedium2', showRowStripes: true },
      columns: tableColumns([
        { name: 'месяц', totalsRowLabel: 'Итого' },
        {
          name: 'операций',
          totalsRowFunction: 'sum',
          totalsRowResult: used.reduce((sum, point) => sum + point.count, 0),
        },
        {
          name: `сумма, ${currency}`,
          totalsRowFunction: 'sum',
          totalsRowResult: used.reduce((sum, point) => sum + point.total, 0),
        },
        { name: 'средняя операция' },
        { name: 'к прошлому месяцу' },
      ]),
      rows,
    });
    table.commit();
    const money = currency === this.options.base ? NUMBER_FORMAT.whole : NUMBER_FORMAT.cents;
    used.forEach((_, index) => {
      const row = 6 + index;
      sheet.getCell(row, 1).numFmt = 'mmmm yyyy';
      sheet.getCell(row, 3).numFmt = money;
      sheet.getCell(row, 4).numFmt = money;
      sheet.getCell(row, 5).numFmt = NUMBER_FORMAT.share;
    });
    sheet.getCell(6 + used.length, 3).numFmt = money;
    sheet.views = [{ state: 'frozen', ySplit: 5 }];
  }

  private breakdownSheet(
    workbook: ExcelJS.Workbook,
    categories: { key: string; total: number; count: number }[],
    cards: { key: string; total: number; count: number }[],
    head: string[],
    { currency }: ReportContext,
  ): void {
    const sheet = workbook.addWorksheet('По категориям');
    this.writeHead(sheet, head);
    [24, 12, 18, 10].forEach((width, index) => (sheet.getColumn(index + 1).width = width));
    const money = currency === this.options.base ? NUMBER_FORMAT.whole : NUMBER_FORMAT.cents;

    let row = 5;
    const write = (title: string, name: string, data: typeof categories) => {
      if (data.length === 0) return;
      const total = data.reduce((sum, item) => sum + item.total, 0);
      const table = sheet.addTable({
        name,
        ref: `A${row}`,
        headerRow: true,
        totalsRow: true,
        style: { theme: 'TableStyleMedium2', showRowStripes: true },
        columns: tableColumns([
          { name: title, totalsRowLabel: 'Итого' },
          {
            name: 'операций',
            totalsRowFunction: 'sum',
            totalsRowResult: data.reduce((sum, item) => sum + item.count, 0),
          },
          { name: `сумма, ${currency}`, totalsRowFunction: 'sum', totalsRowResult: total },
          { name: 'доля' },
        ]),
        rows: data.map((item) => [
          item.key,
          item.count,
          item.total,
          total > 0 ? item.total / total : 0,
        ]),
      });
      table.commit();
      data.forEach((_, index) => {
        sheet.getCell(row + 1 + index, 3).numFmt = money;
        sheet.getCell(row + 1 + index, 4).numFmt = NUMBER_FORMAT.share;
      });
      sheet.getCell(row + 1 + data.length, 3).numFmt = money;
      row += data.length + 4;
    };
    write('категория', 'Категории', categories);
    write('карта', 'Карты', cards);
    if (row === 5) sheet.getCell('A5').value = 'Нет данных';
  }
}

import { TABLE_HEADERS } from './types.ts';
import { findTags, getAttr } from './xml.ts';

export interface TableRange {
  firstColumn: string;
  lastColumn: string;
  headerRow: number;
  lastRow: number;
}

export function readTableRange(tableXml: string): { ref: string; range: TableRange } {
  const tag = findTags(tableXml, 'table')[0] ?? '';
  const ref = getAttr(tag, 'ref') ?? '';
  const match = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(ref);
  if (!match) {
    throw new Error(`Unsupported table ref: ${ref}`);
  }

  return {
    ref,
    range: {
      firstColumn: match[1]!,
      headerRow: Number(match[2]),
      lastColumn: match[3]!,
      lastRow: Number(match[4]),
    },
  };
}

/** Checks that the table is suitable for writing: columns A:E, required headers, no totals row. */
export function assertTableIsSupported(tableXml: string, range: TableRange): void {
  if (range.firstColumn !== 'A' || range.lastColumn !== 'E') {
    throw new Error(`Table must span A:E, got ${range.firstColumn}:${range.lastColumn}`);
  }

  const totalsRowCount = Number(getAttr(findTags(tableXml, 'table')[0] ?? '', 'totalsRowCount'));
  if (totalsRowCount > 0) {
    throw new Error('Tables with totals row are not supported');
  }

  const columnNames = findTags(tableXml, 'tableColumn').map((tag) => getAttr(tag, 'name'));
  if (columnNames.join('|') !== TABLE_HEADERS.join('|')) {
    throw new Error(`Unexpected table columns: ${columnNames.join(', ')}`);
  }
}

/** Replaces the table range (and the autofilter matching it) with a new one. */
export function replaceTableRef(tableXml: string, oldRef: string, newRef: string): string {
  return tableXml.split(`ref="${oldRef}"`).join(`ref="${newRef}"`);
}

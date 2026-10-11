import type JSZip from 'jszip';
import type { ExcelOptions } from './types.ts';
import { findTags, getAttr } from './xml.ts';

export interface LocatedTable {
  sheetPath: string;
  tablePath: string;
  sheetXml: string;
  tableXml: string;
}

/** Finds the sheet and structured table parts in the XLSX package by their names. */
export async function locateTable(zip: JSZip, options: ExcelOptions): Promise<LocatedTable> {
  const sheetPath = await resolveSheetPath(zip, options.sheetName);

  for (const tablePath of await resolveTablePaths(zip, sheetPath)) {
    const tableXml = await readPart(zip, tablePath);
    const tag = findTags(tableXml, 'table')[0] ?? '';

    if (getAttr(tag, 'name') === options.tableName) {
      return { sheetPath, tablePath, tableXml, sheetXml: await readPart(zip, sheetPath) };
    }
  }

  throw new Error(`Table not found: ${options.tableName}`);
}

async function readPart(zip: JSZip, path: string): Promise<string> {
  const file = zip.file(path);
  if (!file) {
    throw new Error(`Missing part: ${path}`);
  }
  return file.async('string');
}

async function resolveSheetPath(zip: JSZip, sheetName: string): Promise<string> {
  const workbook = await readPart(zip, 'xl/workbook.xml');
  const sheetTag = findTags(workbook, 'sheet').find((tag) => getAttr(tag, 'name') === sheetName);
  if (!sheetTag) {
    throw new Error(`Sheet not found: ${sheetName}`);
  }

  const relationshipId = getAttr(sheetTag, 'r:id');
  const relationships = await readPart(zip, 'xl/_rels/workbook.xml.rels');
  const relationshipTag = findTags(relationships, 'Relationship').find(
    (tag) => getAttr(tag, 'Id') === relationshipId,
  );
  const target = getAttr(relationshipTag ?? '', 'Target');
  if (!target) {
    throw new Error(`Relationship not found for sheet: ${sheetName}`);
  }

  return toPartPath(target, 'xl/workbook.xml');
}

async function resolveTablePaths(zip: JSZip, sheetPath: string): Promise<string[]> {
  const relsPath = sheetPath.replace(/([^/]+)$/, '_rels/$1.rels');
  const relationships = await readPart(zip, relsPath);

  return findTags(relationships, 'Relationship')
    .filter((tag) => getAttr(tag, 'Type')?.endsWith('/relationships/table'))
    .map((tag) => toPartPath(getAttr(tag, 'Target')!, sheetPath));
}

/** Turns a relationship Target (absolute or relative) into a path inside the archive. */
function toPartPath(target: string, sourcePart: string): string {
  if (target.startsWith('/')) {
    return target.slice(1);
  }
  return new URL(target, `http://package/${sourcePart}`).pathname.slice(1);
}

import type { AnalyticsFilters } from '../analytics/analytics.types.ts';

const formatDate = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;

/** The period of the report in words. */
export function periodText(filters: AnalyticsFilters): string {
  if (filters.from && filters.to) return `${formatDate(filters.from)} — ${formatDate(filters.to)}`;
  if (filters.from) return `с ${formatDate(filters.from)}`;
  if (filters.to) return `по ${formatDate(filters.to)}`;
  return 'за всё время';
}

/** The filters of the report in words (for the head of the file), so that it is clear what it was made from. */
export function describeFilters(
  filters: AnalyticsFilters,
  authorLabels: Map<string, string> = new Map(),
): string {
  const parts: string[] = [];
  if (filters.cards.length) parts.push(`карты: ${filters.cards.join(', ')}`);
  if (filters.categories.length) parts.push(`категории: ${filters.categories.join(', ')}`);
  if (filters.createdBy.length) {
    parts.push(`добавил: ${filters.createdBy.map((v) => authorLabels.get(v) ?? v).join(', ')}`);
  }
  if (filters.currencies.length) parts.push(`валюта ввода: ${filters.currencies.join(', ')}`);
  if (filters.q) parts.push(`поиск: «${filters.q}»`);
  if (filters.minAmount !== undefined) parts.push(`от ${filters.minAmount}`);
  if (filters.maxAmount !== undefined) parts.push(`до ${filters.maxAmount}`);
  if (filters.includeDeleted) parts.push('включая удалённые');
  return parts.length ? `Фильтры: ${parts.join('; ')}` : 'Фильтры: без ограничений';
}

/** Category count with a Russian plural form: 1 категория, 2 категории, 5 категорий. */
export function pluralCategories(count: number): string {
  const lastTwo = count % 100;
  const last = count % 10;
  if (lastTwo >= 11 && lastTwo <= 14) return 'категорий';
  if (last === 1) return 'категория';
  if (last >= 2 && last <= 4) return 'категории';
  return 'категорий';
}

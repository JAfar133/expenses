/** Moves the item at `from` to `to` (both are indexes of the same list); returns a new array. */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  const next = [...list];
  if (from < 0 || from >= next.length) return next;
  const target = Math.min(Math.max(to, 0), next.length - 1);
  const [item] = next.splice(from, 1);
  next.splice(target, 0, item!);
  return next;
}

/** Keeps `index` inside [min, max]. */
export const clampIndex = (index: number, [min, max]: readonly [number, number]) =>
  Math.min(Math.max(index, min), max);

/**
 * Where the dragged row would land: the number of the OTHER rows whose centre is above the dragged row's centre.
 * `centers` are the original centres of all rows (in list order), `from` is the dragged row.
 */
export function dropIndex(centers: readonly number[], from: number, draggedCenter: number): number {
  return centers.filter((center, index) => index !== from && center < draggedCenter).length;
}

/** The vertical shift (in px) of a row that is NOT dragged, so that it makes room for the dragged one. */
export function shiftOf(index: number, from: number, target: number, height: number): number {
  if (from < target && index > from && index <= target) return -height;
  if (from > target && index >= target && index < from) return height;
  return 0;
}

/**
 * A subset of a list was reordered: puts the reordered items back into the slots the subset occupied, the other
 * items stay where they were.
 */
export function reorderInSlots<T extends { id: string }>(
  full: readonly T[],
  ordered: readonly T[],
): T[] {
  const ids = new Set(ordered.map((item) => item.id));
  let next = 0;
  return full.map((item) => (ids.has(item.id) ? ordered[next++]! : item));
}

/** The list in the order of `ids`; what `ids` does not mention (proposals, other kinds) keeps its order after them. */
export function applyOrder<T extends { id: string }>(
  list: readonly T[],
  ids: readonly string[],
): T[] {
  const known = new Set(ids);
  const ordered = ids
    .map((id) => list.find((item) => item.id === id))
    .filter((item): item is T => item !== undefined);
  return [...ordered, ...list.filter((item) => !known.has(item.id))];
}

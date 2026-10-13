export interface MultiSelection {
  /** Real restrictions: an empty list means «no filter» (everything is shown) */
  selected: string[];
  /** «All except» */
  excluded: string[];
}

const without = (values: string[], value: string) => values.filter((item) => item !== value);

/** What the list shows as ticked: the explicit selection, or everything that is not excluded when there is none. */
export function checkedValues(all: string[], { selected, excluded }: MultiSelection): string[] {
  const open = all.filter((value) => !excluded.includes(value));
  return selected.length > 0 ? selected : open;
}

/**
 * A tick toggled. If every value that is not excluded ends up ticked, that is not a restriction: the selection is
 * cleared (nothing is sent to the server). The last ticked value cannot be unticked (an empty result makes no sense).
 */
export function toggleValue(all: string[], current: MultiSelection, value: string): MultiSelection {
  const checked = checkedValues(all, current);
  const next = checked.includes(value) ? without(checked, value) : [...checked, value];
  if (next.length === 0) return current;
  const open = all.filter((item) => !current.excluded.includes(item));
  const everything = open.every((item) => next.includes(item));
  return { selected: everything ? [] : next, excluded: current.excluded };
}

/** A value excluded: it leaves the selection; a value is never both selected and excluded. */
export function excludeValue(current: MultiSelection, value: string): MultiSelection {
  return { selected: without(current.selected, value), excluded: [...current.excluded, value] };
}

export function restoreValue(current: MultiSelection, value: string): MultiSelection {
  return { selected: current.selected, excluded: without(current.excluded, value) };
}

/** The line on the button: «Все карты», a name, «3 из 5» or «Кроме: кафе». */
export function selectionSummary(
  all: { value: string; label: string }[],
  { selected, excluded }: MultiSelection,
  allText: string,
): string {
  const label = (value: string) => all.find((option) => option.value === value)?.label ?? value;
  const parts: string[] = [];
  if (selected.length === 1) parts.push(label(selected[0]!));
  else if (selected.length > 1) parts.push(`${selected.length} из ${all.length}`);
  if (excluded.length > 0) parts.push(`кроме: ${excluded.map(label).join(', ')}`);
  return parts.length === 0 ? allText : parts.join(' · ');
}

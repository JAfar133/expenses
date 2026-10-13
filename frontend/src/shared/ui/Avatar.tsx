const COLORS = [
  'bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300',
  'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
  'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300',
  'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300',
  'bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300',
  'bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300',
];

/** A round avatar with the initial; the color is stable for a name. */
export function Avatar({ name }: { name: string }) {
  const hash = [...name].reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) % 9973, 7);
  return (
    <span
      aria-hidden="true"
      className={`flex size-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${COLORS[hash % COLORS.length]}`}
    >
      {name.trim().charAt(0).toUpperCase()}
    </span>
  );
}

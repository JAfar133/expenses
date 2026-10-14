/** «Категории — 9 выбрано из 11» (no chevron: the chips under it are edited in place). */
export function CategoriesCount({ chosen, total }: { chosen: number; total: number }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="font-medium">Категории</span>
      <span className="text-zinc-500 dark:text-zinc-400">
        {chosen} выбрано из {total}
      </span>
    </div>
  );
}

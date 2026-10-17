import type { Recipient } from '../api/broadcast.api.ts';

/** A checkbox list of people with «Выбрать всех / Снять». The admin also sees the group of everyone. */
export function RecipientPicker({
  users,
  selected,
  onChange,
  showGroup,
}: {
  users: Recipient[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
  showGroup: boolean;
}) {
  const all = users.length > 0 && users.every((user) => selected.has(user.id));
  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(next);
  };

  return (
    <div className="space-y-1">
      <button
        type="button"
        onClick={() => onChange(all ? new Set() : new Set(users.map((user) => user.id)))}
        className="h-9 rounded-lg px-2 text-sm font-medium text-indigo-600 hover:bg-indigo-50 dark:text-indigo-300 dark:hover:bg-indigo-950/60"
      >
        {all ? 'Снять' : 'Выбрать всех'}
      </button>
      <ul className="max-h-64 divide-y divide-zinc-100 overflow-y-auto rounded-xl border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-700">
        {users.map((user) => (
          <li key={user.id}>
            <label className="flex min-h-11 cursor-pointer items-center gap-3 px-3 py-2">
              <input
                type="checkbox"
                checked={selected.has(user.id)}
                onChange={() => toggle(user.id)}
                className="size-5 shrink-0 accent-indigo-600"
              />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium">{user.name}</span>
                  {user.role === 'owner' && showGroup && (
                    <span className="shrink-0 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                      владелец
                    </span>
                  )}
                </span>
                {showGroup && user.group && (
                  <span className="block truncate text-xs text-zinc-500 dark:text-zinc-400">
                    {user.group}
                  </span>
                )}
              </span>
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}

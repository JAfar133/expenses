import { useState } from 'react';
import { ActionMenu } from '../../../shared/ui/ActionMenu.tsx';
import {
  ArchiveIcon,
  GaugeIcon,
  MergeIcon,
  PencilIcon,
  UndoIcon,
} from '../../../shared/ui/icons.tsx';
import { currencyDigits } from '../../../shared/utils/conversion.ts';
import { formatAmount } from '../../../shared/utils/money.ts';
import type { Budget } from '../../budgets/api/budgets.api.ts';
import { useBudgets } from '../../budgets/hooks/useBudgets.ts';
import { commonPeriod, periodOf } from '../../budgets/model/common-period.ts';
import { useConfig } from '../../expenses/hooks/useConfig.ts';
import { SettingsSection } from '../../settings/components/SettingsSection.tsx';
import { createCategory, updateCategory, type GroupCategory } from '../api/group.api.ts';
import { useGroupMutation } from '../hooks/useGroup.ts';
import { AddButton } from './AddButton.tsx';
import { ErrorNotice } from './ErrorNotice.tsx';
import { GroupRow } from './GroupRow.tsx';
import { LimitDialog } from './LimitDialog.tsx';
import { MergeCategoryDialog } from './MergeCategoryDialog.tsx';
import { NameDialog } from './NameDialog.tsx';
import { OverallLimitRow } from './OverallLimitRow.tsx';

type CategoryPatch = {
  id: string;
  patch: { name?: string; archived?: boolean; mergeInto?: string };
};

/** «Категории и лимиты»: the overall limit on top, a row per category with its limit and a «⋯» menu. */
export function CategoriesCard({ categories }: { categories: GroupCategory[] }) {
  const [adding, setAdding] = useState(false);
  const [renaming, setRenaming] = useState<GroupCategory | null>(null);
  const [merging, setMerging] = useState<GroupCategory | null>(null);
  // The owner of a limit being edited; `id: null` is the overall limit of the group
  const [limiting, setLimiting] = useState<{ id: string | null; label: string } | null>(null);

  const add = useGroupMutation(createCategory);
  const update = useGroupMutation(({ id, patch }: CategoryPatch) => updateCategory(id, patch));
  const budgets = useBudgets().data;
  const config = useConfig().data;

  const active = categories.filter((category) => !category.archived);
  const archived = categories.filter((category) => category.archived);

  const currency = config?.currency ?? '';
  const digits = config ? currencyDigits(config.currency, config.baseCurrency) : 0;
  const money = (value: number) => `${formatAmount(value, digits)} ${currency}`;
  const list: Budget[] = Array.isArray(budgets) ? budgets : [];
  const limitOf = (categoryId: string | null) =>
    list.find((budget) => budget.categoryId === categoryId);
  const common = commonPeriod(list);

  return (
    <SettingsSection
      title={`Категории и лимиты (${active.length})`}
      compact
      hint="Лимит — сколько можно потратить по категории (или по всем) за период: месяц, месяц с выбранного числа или неделя. Участники видят полоски, но не меняют лимиты."
      action={<AddButton label="Добавить" onClick={() => setAdding(true)} />}
    >
      {config && (
        <OverallLimitRow
          budget={limitOf(null)}
          money={money}
          common={common}
          onEdit={() => setLimiting({ id: null, label: 'Все категории' })}
        />
      )}
      {common && (
        <p className="text-xs text-zinc-500 dark:text-zinc-400">Период лимитов: {common}</p>
      )}
      <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
        {active.map((category) => {
          const budget = limitOf(category.id);
          return (
            <GroupRow
              key={category.id}
              main={<div className="truncate text-sm font-medium">{category.name}</div>}
              trailing={
                <span className="text-sm tabular-nums">
                  {budget ? (
                    <>
                      {money(budget.limit)}
                      {common === null && (
                        <span className="text-zinc-500 dark:text-zinc-400">
                          {' '}
                          · {periodOf(budget)}
                        </span>
                      )}
                    </>
                  ) : (
                    <span className="text-zinc-400">—</span>
                  )}
                </span>
              }
              menu={
                <ActionMenu
                  label={`Действия: ${category.name}`}
                  actions={[
                    {
                      label: 'Переименовать',
                      icon: <PencilIcon />,
                      onSelect: () => setRenaming(category),
                    },
                    ...(config
                      ? [
                          {
                            label: 'Лимит…',
                            icon: <GaugeIcon />,
                            onSelect: () => setLimiting({ id: category.id, label: category.name }),
                          },
                        ]
                      : []),
                    ...(active.length > 1
                      ? [
                          {
                            label: 'Слить с другой',
                            icon: <MergeIcon />,
                            onSelect: () => setMerging(category),
                          },
                        ]
                      : []),
                    {
                      label: 'В архив',
                      icon: <ArchiveIcon />,
                      tone: 'danger' as const,
                      onSelect: () => update.mutate({ id: category.id, patch: { archived: true } }),
                    },
                  ]}
                />
              }
            />
          );
        })}
      </ul>
      {archived.length > 0 && (
        <details>
          <summary className="cursor-pointer text-sm text-zinc-500">
            Архив категорий ({archived.length})
          </summary>
          <ul className="mt-2 divide-y divide-zinc-100 dark:divide-zinc-800">
            {archived.map((category) => (
              <GroupRow
                key={category.id}
                main={<div className="truncate text-sm text-zinc-500">{category.name}</div>}
                menu={
                  <button
                    type="button"
                    aria-label={`Вернуть: ${category.name}`}
                    title="Вернуть"
                    onClick={() => update.mutate({ id: category.id, patch: { archived: false } })}
                    className="flex size-10 items-center justify-center rounded-lg text-green-700 hover:bg-green-50 sm:size-9 dark:text-green-400 dark:hover:bg-green-950/60"
                  >
                    <UndoIcon />
                  </button>
                }
              />
            ))}
          </ul>
        </details>
      )}
      <ErrorNotice mutations={[update]} />

      {adding && (
        <NameDialog
          title="Новая категория"
          label="Название категории"
          submitLabel="Добавить"
          onClose={() => setAdding(false)}
          onSubmit={(name) => add.mutateAsync(name)}
        />
      )}
      {renaming && (
        <NameDialog
          title={`Переименовать категорию: ${renaming.name}`}
          label={`Новое название: ${renaming.name}`}
          initial={renaming.name}
          submitLabel="Сохранить"
          onClose={() => setRenaming(null)}
          onSubmit={(name) =>
            name === renaming.name
              ? Promise.resolve()
              : update.mutateAsync({ id: renaming.id, patch: { name } })
          }
        />
      )}
      {limiting && (
        <LimitDialog
          label={limiting.label}
          categoryId={limiting.id}
          budget={limitOf(limiting.id)}
          currency={currency}
          digits={digits}
          onClose={() => setLimiting(null)}
        />
      )}
      {merging && (
        <MergeCategoryDialog
          category={merging}
          targets={active.filter((category) => category.id !== merging.id)}
          busy={update.isPending}
          onCancel={() => setMerging(null)}
          onMerge={async (targetId) => {
            try {
              await update.mutateAsync({ id: merging.id, patch: { mergeInto: targetId } });
            } catch {
              // The error is shown below the list
            }
            setMerging(null);
          }}
        />
      )}
    </SettingsSection>
  );
}

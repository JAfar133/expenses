import { useState } from 'react';
import { ActionMenu } from '../../../shared/ui/ActionMenu.tsx';
import {
  ArchiveIcon,
  CreditCardIcon,
  PencilIcon,
  RefreshIcon,
  UndoIcon,
} from '../../../shared/ui/icons.tsx';
import { SettingsSection } from '../../settings/components/SettingsSection.tsx';
import { updateCard, type GroupCard } from '../api/group.api.ts';
import { useGroupMutation } from '../hooks/useGroup.ts';
import { AddButton } from './AddButton.tsx';
import { AddCardDialog } from './AddCardDialog.tsx';
import { CardDigitsDialog } from './CardDigitsDialog.tsx';
import { CardCurrencyDialog } from './CardCurrencyDialog.tsx';
import { ErrorNotice } from './ErrorNotice.tsx';
import { GroupRow } from './GroupRow.tsx';
import { NameDialog } from './NameDialog.tsx';

interface CardsCardProps {
  cards: GroupCard[];
  /** Currencies allowed for cards */
  currencies: string[];
  /** The default currency of a new card */
  reportingCurrency: string;
}

const CardBadge = () => (
  <span
    aria-hidden="true"
    className="flex size-10 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
  >
    <CreditCardIcon />
  </span>
);

/** «Карты»: add in a window, a «⋯» menu per card (rename, currency, archive), the archive is collapsed. */
export function CardsCard({ cards, currencies, reportingCurrency }: CardsCardProps) {
  const [adding, setAdding] = useState(false);
  const [renaming, setRenaming] = useState<GroupCard | null>(null);
  const [currencyOf, setCurrencyOf] = useState<GroupCard | null>(null);
  const [digitsOf, setDigitsOf] = useState<GroupCard | null>(null);
  const update = useGroupMutation(
    ({
      id,
      patch,
    }: {
      id: string;
      patch: { name?: string; archived?: boolean; last4?: string | null };
    }) => updateCard(id, patch),
  );
  const active = cards.filter((card) => !card.archived);
  const archived = cards.filter((card) => card.archived);

  return (
    <SettingsSection
      title={`Карты (${active.length})`}
      compact
      action={<AddButton label="Добавить" onClick={() => setAdding(true)} />}
    >
      <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
        {active.map((card) => (
          <GroupRow
            key={card.id}
            lead={<CardBadge />}
            main={
              <div className="truncate text-sm font-medium">
                {card.name}
                {card.last4 && (
                  <span className="ml-1.5 font-mono text-xs font-normal text-zinc-500 dark:text-zinc-400">
                    •{card.last4}
                  </span>
                )}
              </div>
            }
            trailing={
              <span className="text-sm text-zinc-500 dark:text-zinc-400">{card.currency}</span>
            }
            menu={
              <ActionMenu
                label={`Действия: ${card.name}`}
                actions={[
                  {
                    label: 'Переименовать',
                    icon: <PencilIcon />,
                    onSelect: () => setRenaming(card),
                  },
                  ...(currencies.length > 1
                    ? [
                        {
                          label: 'Сменить валюту',
                          icon: <RefreshIcon />,
                          onSelect: () => setCurrencyOf(card),
                        },
                      ]
                    : []),
                  {
                    label: 'Цифры карты',
                    icon: <CreditCardIcon />,
                    onSelect: () => setDigitsOf(card),
                  },
                  {
                    label: 'В архив',
                    icon: <ArchiveIcon />,
                    tone: 'danger' as const,
                    onSelect: () => update.mutate({ id: card.id, patch: { archived: true } }),
                  },
                ]}
              />
            }
          />
        ))}
      </ul>
      {archived.length > 0 && (
        <details>
          <summary className="cursor-pointer text-sm text-zinc-500">
            Архив карт ({archived.length})
          </summary>
          <ul className="mt-2 divide-y divide-zinc-100 dark:divide-zinc-800">
            {archived.map((card) => (
              <GroupRow
                key={card.id}
                lead={<CardBadge />}
                main={<div className="truncate text-sm text-zinc-500">{card.name}</div>}
                trailing={<span className="text-sm text-zinc-400">{card.currency}</span>}
                menu={
                  <button
                    type="button"
                    aria-label={`Вернуть: ${card.name}`}
                    title="Вернуть"
                    onClick={() => update.mutate({ id: card.id, patch: { archived: false } })}
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
        <AddCardDialog
          currencies={currencies}
          reportingCurrency={reportingCurrency}
          onClose={() => setAdding(false)}
        />
      )}
      {digitsOf && (
        <CardDigitsDialog
          cardName={digitsOf.name}
          initial={digitsOf.last4 ?? null}
          onClose={() => setDigitsOf(null)}
          onSubmit={(last4) => update.mutateAsync({ id: digitsOf.id, patch: { last4 } })}
        />
      )}
      {renaming && (
        <NameDialog
          title={`Переименовать карту: ${renaming.name}`}
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
      {currencyOf && (
        <CardCurrencyDialog
          card={currencyOf}
          currencies={currencies}
          onClose={() => setCurrencyOf(null)}
        />
      )}
    </SettingsSection>
  );
}

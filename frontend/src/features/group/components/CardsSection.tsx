import { useState } from 'react';
import { SettingsSection } from '../../settings/components/SettingsSection.tsx';
import {
  createCard,
  setCardAccess,
  updateCard,
  type AccessLevel,
  type GroupCard,
  type GroupMember,
} from '../api/group.api.ts';
import { useGroupMutation } from '../hooks/useGroup.ts';
import { AddNameForm } from './AddNameForm.tsx';
import { CardAccess } from './CardAccess.tsx';
import { EditableName } from './EditableName.tsx';
import { ErrorNotice } from './ErrorNotice.tsx';
import { smallButtonClass } from './styles.ts';

type CardPatch = { id: number; patch: { name?: string; archived?: boolean } };
type AccessChange = { id: number; access: Record<string, AccessLevel> };

interface CardsSectionProps {
  cards: GroupCard[];
  members: GroupMember[];
}

/** Cards of the group: add, rename, archive, and who may see or add to each card. */
export function CardsSection({ cards, members }: CardsSectionProps) {
  const [openAccess, setOpenAccess] = useState<number | null>(null);
  const add = useGroupMutation(createCard);
  const update = useGroupMutation(({ id, patch }: CardPatch) => updateCard(id, patch));
  const access = useGroupMutation(({ id, access }: AccessChange) => setCardAccess(id, access));
  const hasOthers = members.some((member) => member.role !== 'owner');
  const active = cards.filter((card) => !card.archived);
  const archived = cards.filter((card) => card.archived);

  return (
    <SettingsSection title="Карты">
      <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
        {active.map((card) => (
          <li key={card.id} className="py-1">
            <div className="flex flex-wrap items-center justify-between gap-x-2">
              <EditableName
                name={card.name}
                onRename={(name) => update.mutateAsync({ id: card.id, patch: { name } })}
              />
              <div className="flex">
                {hasOthers && (
                  <button
                    type="button"
                    aria-label={`Доступ: ${card.name}`}
                    aria-expanded={openAccess === card.id}
                    className={smallButtonClass}
                    onClick={() => setOpenAccess(openAccess === card.id ? null : card.id)}
                  >
                    Доступ
                  </button>
                )}
                <button
                  type="button"
                  aria-label={`В архив: ${card.name}`}
                  className={smallButtonClass}
                  onClick={() => update.mutate({ id: card.id, patch: { archived: true } })}
                >
                  В архив
                </button>
              </div>
            </div>
            {openAccess === card.id && (
              <CardAccess
                card={card}
                members={members}
                disabled={access.isPending}
                onChange={(map) => access.mutate({ id: card.id, access: map })}
              />
            )}
          </li>
        ))}
      </ul>
      <AddNameForm
        label="Новая карта"
        placeholder="Новая карта"
        busy={add.isPending}
        onAdd={(name) => add.mutateAsync(name)}
      />
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        Владельцы видят все карты. Участники видят только карты, к которым им дан доступ.
      </p>
      {archived.length > 0 && (
        <details>
          <summary className="cursor-pointer text-sm text-zinc-500">
            Архив карт ({archived.length})
          </summary>
          <ul className="mt-2 divide-y divide-zinc-100 dark:divide-zinc-800">
            {archived.map((card) => (
              <li key={card.id} className="flex items-center justify-between gap-2 py-1">
                <span className="truncate text-zinc-500">{card.name}</span>
                <button
                  type="button"
                  aria-label={`Вернуть: ${card.name}`}
                  className={smallButtonClass}
                  onClick={() => update.mutate({ id: card.id, patch: { archived: false } })}
                >
                  Вернуть
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
      <ErrorNotice mutations={[add, update, access]} />
    </SettingsSection>
  );
}

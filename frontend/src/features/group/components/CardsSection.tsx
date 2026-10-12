import { ArchiveIcon, LockIcon, PencilIcon, UndoIcon } from '../../../shared/ui/icons.tsx';
import { useState } from 'react';
import { HintList } from '../../../shared/ui/HelpHint.tsx';
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
import { EditableRow } from './EditableRow.tsx';
import { ErrorNotice } from './ErrorNotice.tsx';
import { ActionButton, ListRow, RowActions } from './ListRow.tsx';

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
    <SettingsSection
      title="Карты"
      hint={
        <HintList
          intro="Владельцы видят все карты. Участники видят только карты, к которым им дан доступ."
          items={[
            [
              'Изменить',
              'новое название сразу меняется везде, в том числе в прошлых тратах.',
              <PencilIcon />,
            ],
            [
              'В архив',
              'карта пропадёт из формы добавления; прошлые траты, графики и итоги остаются, вернуть можно в любой момент.',
              <ArchiveIcon />,
            ],
            [
              'Доступ',
              'нет доступа — карта и её траты скрыты; только смотреть — траты видны, но добавлять нельзя; добавлять — можно вносить новые траты.',
              <LockIcon />,
            ],
          ]}
        />
      }
    >
      <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
        {active.map((card) => (
          <EditableRow
            key={card.id}
            name={card.name}
            onRename={(name) => update.mutateAsync({ id: card.id, patch: { name } })}
            below={
              openAccess === card.id && (
                <CardAccess
                  card={card}
                  members={members}
                  disabled={access.isPending}
                  onChange={(map) => access.mutate({ id: card.id, access: map })}
                />
              )
            }
          >
            {hasOthers && (
              <ActionButton
                label={`Доступ: ${card.name}`}
                aria-expanded={openAccess === card.id}
                onClick={() => setOpenAccess(openAccess === card.id ? null : card.id)}
                icon={<LockIcon />}
              />
            )}
            <ActionButton
              label={`В архив: ${card.name}`}
              onClick={() => update.mutate({ id: card.id, patch: { archived: true } })}
              tone="danger"
              icon={<ArchiveIcon />}
            />
          </EditableRow>
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
              <ListRow
                key={card.id}
                main={<span className="block text-zinc-500">{card.name}</span>}
              >
                <RowActions>
                  <ActionButton
                    label={`Вернуть: ${card.name}`}
                    onClick={() => update.mutate({ id: card.id, patch: { archived: false } })}
                    tone="success"
                    icon={<UndoIcon />}
                  />
                </RowActions>
              </ListRow>
            ))}
          </ul>
        </details>
      )}
      <ErrorNotice mutations={[add, update, access]} />
    </SettingsSection>
  );
}

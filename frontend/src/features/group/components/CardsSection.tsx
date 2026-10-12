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
import { compactSelectClass } from './styles.ts';
import { AddNameForm } from './AddNameForm.tsx';
import { CardAccess } from './CardAccess.tsx';
import { EditableRow } from './EditableRow.tsx';
import { ErrorNotice } from './ErrorNotice.tsx';
import { ActionButton, ListRow, RowActions } from './ListRow.tsx';

type CardPatch = {
  id: string;
  patch: { name?: string; archived?: boolean; currency?: string };
};
type AccessChange = { id: string; access: Record<string, AccessLevel> };

interface CardsSectionProps {
  cards: GroupCard[];
  members: GroupMember[];
  /** Currencies allowed for cards */
  currencies: string[];
  /** The group's reporting currency: the default for a new card */
  reportingCurrency: string;
}

/** Cards of the group: add, rename, archive, and who may see or add to each card. */
export function CardsSection({ cards, members, currencies, reportingCurrency }: CardsSectionProps) {
  const [openAccess, setOpenAccess] = useState<string | null>(null);
  const [newCurrency, setNewCurrency] = useState(reportingCurrency);
  const add = useGroupMutation(({ name, currency }: { name: string; currency?: string }) =>
    createCard(name, currency),
  );
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
          intro="Владельцы видят все карты. Участники видят только карты, к которым им дан доступ. Валюта карты задаётся при создании; пока по карте нет трат, её можно изменить."
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
              'Валюта',
              'задаётся при создании карты; пока по карте нет трат, её можно изменить кнопкой «Изменить».',
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
            meta={card.currency}
            currency={{ value: card.currency, options: currencies }}
            onRename={(name, currency) =>
              update.mutateAsync({
                id: card.id,
                patch: {
                  ...(name !== card.name ? { name } : {}),
                  ...(currency ? { currency } : {}),
                },
              })
            }
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
        extra={
          currencies.length > 1 && (
            <select
              aria-label="Валюта новой карты"
              value={newCurrency}
              onChange={(event) => setNewCurrency(event.target.value)}
              className={`${compactSelectClass} h-11 min-w-0 flex-1 sm:h-11 sm:flex-none`}
            >
              {currencies.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </select>
          )
        }
        onAdd={(name) =>
          add.mutateAsync({ name, currency: currencies.length > 1 ? newCurrency : undefined })
        }
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

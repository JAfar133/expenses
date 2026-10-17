import { Navigate } from 'react-router';
import { lazy } from 'react';
import { SectionsPage } from '../../../shared/sections/SectionsPage.tsx';
import { Notice } from '../../../shared/ui/Notice.tsx';
import { useCurrentUser } from '../../auth/hooks/useAuth.ts';
import { CardsCard } from '../components/CardsCard.tsx';
import { GroupGeneralCard } from '../components/GroupGeneralCard.tsx';
import { GroupReceiptsCard } from '../components/GroupReceiptsCard.tsx';
import { MembersCard } from '../components/MembersCard.tsx';
import type { GroupOverview } from '../api/group.api.ts';
import { useGroup } from '../hooks/useGroup.ts';
import { useGroupRows } from '../hooks/useGroupRows.tsx';
import { toErrorMessage } from '../model/error-message.ts';

// The heavier sections load when they are opened
const CategoriesCard = lazy(() =>
  import('../components/CategoriesCard.tsx').then((m) => ({ default: m.CategoriesCard })),
);
const GroupTemplatesCard = lazy(() =>
  import('../../templates/components/GroupTemplatesCard.tsx').then((m) => ({
    default: m.GroupTemplatesCard,
  })),
);
const IntegrationsCard = lazy(() =>
  import('../../integrations/components/IntegrationsCard.tsx').then((m) => ({
    default: m.IntegrationsCard,
  })),
);
const BroadcastCard = lazy(() =>
  import('../../notifications/components/BroadcastCard.tsx').then((m) => ({
    default: m.BroadcastCard,
  })),
);

const SECTIONS = [
  { id: 'general', title: 'Основные' },
  { id: 'members', title: 'Участники и приглашения' },
  { id: 'cards', title: 'Карты' },
  { id: 'categories', title: 'Категории и лимиты' },
  { id: 'templates', title: 'Шаблоны группы' },
  { id: 'receipts', title: 'Чеки и ИИ' },
  { id: 'integrations', title: 'Интеграции' },
  { id: 'broadcast', title: 'Сообщение участникам' },
];

/**
 * Owner's page, in sections like the personal settings: general, members, cards, categories with limits, the group's
 * templates, receipts and AI, integrations and the message to members.
 */
export default function GroupPage() {
  const { data: user } = useCurrentUser();
  if (!user) return null;
  if (user.role !== 'owner') return <Navigate to="/" replace />;
  return <GroupContent currentUsername={user.username} />;
}

function GroupContent({ currentUsername }: { currentUsername: string }) {
  const group = useGroup();

  if (group.isError) return <Notice variant="error">{toErrorMessage(group.error)}</Notice>;
  if (!group.data) {
    return (
      <p role="status" className="py-8 text-center text-zinc-500">
        Загрузка…
      </p>
    );
  }
  return <Sections data={group.data} currentUsername={currentUsername} />;
}

function Sections({ data, currentUsername }: { data: GroupOverview; currentUsername: string }) {
  const groups = useGroupRows(data);
  const currencies = data.currencies ?? [];

  const section = (id: string) => {
    switch (id) {
      case 'general':
        return <GroupGeneralCard group={data.group} currencies={currencies} />;
      case 'members':
        return (
          <MembersCard
            members={data.members}
            invitations={data.invitations}
            cards={data.cards}
            currentUsername={currentUsername}
          />
        );
      case 'cards':
        return (
          <CardsCard
            cards={data.cards}
            currencies={currencies}
            reportingCurrency={data.group.reportingCurrency}
          />
        );
      case 'categories':
        return <CategoriesCard categories={data.categories} />;
      case 'templates':
        return <GroupTemplatesCard />;
      case 'receipts':
        return <GroupReceiptsCard categories={data.categories} />;
      case 'integrations':
        return <IntegrationsCard cards={data.cards} categories={data.categories} />;
      default:
        return <BroadcastCard mode="owner" groupId={data.group.id} />;
    }
  };

  return (
    <SectionsPage
      base="/group"
      hubTitle={`Группа «${data.group.name}»`}
      groups={groups}
      sections={SECTIONS}
      firstSection="general"
      backLabel="Группа"
      renderSection={section}
    />
  );
}

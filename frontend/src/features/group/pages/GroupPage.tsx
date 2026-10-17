import { Navigate } from 'react-router';
import { Notice } from '../../../shared/ui/Notice.tsx';
import { useCurrentUser } from '../../auth/hooks/useAuth.ts';
import { CardsCard } from '../components/CardsCard.tsx';
import { CategoriesCard } from '../components/CategoriesCard.tsx';
import { GroupSettingsCard } from '../components/GroupSettingsCard.tsx';
import { MembersCard } from '../components/MembersCard.tsx';
import { IntegrationsCard } from '../../integrations/components/IntegrationsCard.tsx';
import { GroupTemplatesCard } from '../../templates/components/GroupTemplatesCard.tsx';
import { useGroup } from '../hooks/useGroup.ts';
import { toErrorMessage } from '../model/error-message.ts';

/** Owner's page: six cards: the group settings, members, cards, categories with limits, the group's templates and integrations. */
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
  const { data } = group;
  const currencies = data.currencies ?? [];

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold">Группа</h2>
      <GroupSettingsCard group={data.group} currencies={currencies} categories={data.categories} />
      <MembersCard
        members={data.members}
        invitations={data.invitations}
        cards={data.cards}
        currentUsername={currentUsername}
      />
      <div id="group-cards">
        <CardsCard
          cards={data.cards}
          currencies={currencies}
          reportingCurrency={data.group.reportingCurrency}
        />
      </div>
      <CategoriesCard categories={data.categories} />
      <GroupTemplatesCard />
      <IntegrationsCard cards={data.cards} />
    </div>
  );
}

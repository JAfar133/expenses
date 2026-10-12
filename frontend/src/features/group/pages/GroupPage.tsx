import { Navigate } from 'react-router';
import { Notice } from '../../../shared/ui/Notice.tsx';
import { useCurrentUser } from '../../auth/hooks/useAuth.ts';
import { CardsSection } from '../components/CardsSection.tsx';
import { CategoriesSection } from '../components/CategoriesSection.tsx';
import { GroupNameSection } from '../components/GroupNameSection.tsx';
import { InvitationsSection } from '../components/InvitationsSection.tsx';
import { MembersSection } from '../components/MembersSection.tsx';
import { useGroup } from '../hooks/useGroup.ts';
import { toErrorMessage } from '../model/error-message.ts';

/** Owner's page: group name, members, invitations, cards and categories. */
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

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold">Группа</h2>
      <GroupNameSection name={data.group.name} />
      <MembersSection members={data.members} currentUsername={currentUsername} />
      <InvitationsSection invitations={data.invitations} />
      <CardsSection cards={data.cards} members={data.members} />
      <CategoriesSection categories={data.categories} />
    </div>
  );
}

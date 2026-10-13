import { Navigate } from 'react-router';
import { useCurrentUser } from '../../auth/hooks/useAuth.ts';
import { AdminAiSection } from '../components/AdminAiSection.tsx';
import { BackupSection } from '../components/BackupSection.tsx';
import { GroupsSection } from '../components/GroupsSection.tsx';
import { PasswordResetSection } from '../components/PasswordResetSection.tsx';
import { SyncSection } from '../components/SyncSection.tsx';

/** Application administration: groups and password reset links. Only for an application admin. */
export default function AdminPage() {
  const { data: user } = useCurrentUser();
  if (!user) return null;
  if (!user.isAdmin) return <Navigate to="/" replace />;

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold">Администрирование</h2>
      <BackupSection />
      <GroupsSection />
      <PasswordResetSection />
      <AdminAiSection />
      <SyncSection />
    </div>
  );
}

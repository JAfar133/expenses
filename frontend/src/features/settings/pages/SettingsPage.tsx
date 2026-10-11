import { useCurrentUser } from '../../auth/hooks/useAuth.ts';
import { AccountSection } from '../components/AccountSection.tsx';
import { AnalyticsSection } from '../components/AnalyticsSection.tsx';
import { UsersSection } from '../components/UsersSection.tsx';
import { PasswordSection } from '../components/PasswordSection.tsx';

/**
 * Настройки пользователя. Страница собрана из независимых блоков: новая настройка это новый блок в списке.
 */
export default function SettingsPage() {
  const { data: user } = useCurrentUser();
  if (!user) return null;

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold">Настройки</h2>
      <AccountSection user={user} />
      <PasswordSection />
      <AnalyticsSection />
      {user.canEdit && <UsersSection />}
    </div>
  );
}

import { useCurrentUser } from '../../auth/hooks/useAuth.ts';
import { AccountCard } from '../components/AccountCard.tsx';
import { AppearanceCard } from '../components/AppearanceCard.tsx';
import { AnalyticsSettingsCard } from '../components/AnalyticsSettingsCard.tsx';
import { TemplatesCard } from '../../templates/components/TemplatesCard.tsx';
import { NotificationsCard } from '../components/NotificationsCard.tsx';
import { SecurityCard } from '../components/SecurityCard.tsx';

/** User settings: cards: the account, security, templates, notifications, appearance and the analytics display. */
export default function SettingsPage() {
  const { data: user } = useCurrentUser();
  if (!user) return null;

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold">Настройки</h2>
      <AccountCard user={user} />
      <SecurityCard />
      <TemplatesCard />
      <NotificationsCard />
      <AppearanceCard />
      <AnalyticsSettingsCard />
    </div>
  );
}

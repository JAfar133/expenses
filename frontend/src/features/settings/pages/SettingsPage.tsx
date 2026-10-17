import { SectionsPage } from '../../../shared/sections/SectionsPage.tsx';
import { useCurrentUser } from '../../auth/hooks/useAuth.ts';
import { TemplatesCard } from '../../templates/components/TemplatesCard.tsx';
import type { AuthUser } from '../../auth/api/auth.api.ts';
import { AccountCard } from '../components/AccountCard.tsx';
import { AnalyticsSettingsCard } from '../components/AnalyticsSettingsCard.tsx';
import { AppearanceCard } from '../components/AppearanceCard.tsx';
import { NotificationsCard } from '../components/NotificationsCard.tsx';
import { SecurityCard } from '../components/SecurityCard.tsx';
import { SettingsLogout, SettingsProfile } from '../components/SettingsProfile.tsx';
import { useSettingsRows } from '../hooks/useSettingsRows.tsx';
import { SECTIONS } from '../model/sections.ts';

function Section({ id, user }: { id: string; user: AuthUser }) {
  switch (id) {
    case 'account':
      return (
        <>
          <AccountCard user={user} />
          <SecurityCard />
        </>
      );
    case 'templates':
      return <TemplatesCard />;
    case 'notifications':
      return <NotificationsCard />;
    case 'appearance':
      return <AppearanceCard />;
    default:
      return <AnalyticsSettingsCard />;
  }
}

/**
 * Personal settings: a list of sections on a phone, a menu and the section side by side on a desktop (`/settings`
 * goes to the first section there). `/settings#notifications` (an old link) goes to its section.
 */
export default function SettingsPage() {
  const { data: user } = useCurrentUser();
  if (!user) return null;
  return <Settings user={user} />;
}

function Settings({ user }: { user: AuthUser }) {
  const { personal, app } = useSettingsRows(user);
  return (
    <SectionsPage
      base="/settings"
      hubTitle="Настройки"
      hubTop={<SettingsProfile user={user} />}
      hubFooter={<SettingsLogout />}
      groups={[
        { label: 'Для меня', menuLabel: 'Разделы настроек', rows: personal },
        ...(app.length > 0 ? [{ label: 'Группа и приложение', rows: app }] : []),
      ]}
      sections={SECTIONS}
      firstSection="account"
      backLabel="Настройки"
      legacyHash={{ hash: '#notifications', to: '/settings/notifications' }}
      renderSection={(id) => <Section id={id} user={user} />}
    />
  );
}

import {
  BellIcon,
  BoltIcon,
  ChartIcon,
  PaletteIcon,
  ShieldIcon,
  UserIcon,
  UsersIcon,
} from '../../../shared/ui/icons.tsx';
import type { AuthUser } from '../../auth/api/auth.api.ts';
import { usePreference } from '../../preferences/hooks/usePreferences.ts';
import { PREFERENCES } from '../../preferences/model/preferences.ts';
import { usePushStatus, type PushStatus } from '../../push/hooks/usePush.ts';
import { useTemplates } from '../../templates/hooks/useTemplates.ts';
import type { RowData } from '../../../shared/sections/model.ts';

const PUSH_VALUES: Record<PushStatus, string | undefined> = {
  loading: undefined,
  on: 'Включены',
  off: 'Выключены',
  denied: 'Запрещены',
  'server-off': 'Нет на сервере',
  'needs-install': 'Нужна установка',
  unsupported: 'Не поддерживаются',
};

const pushValue = (status: PushStatus) => PUSH_VALUES[status];

/**
 * The rows of the personal settings: the sections «Для меня» (with the current values taken from what the app already
 * knows) and, below them, the group and the administration for those who may use them.
 */
export function useSettingsRows(user: AuthUser) {
  const { data: templates } = useTemplates();
  const push = usePushStatus();
  const [theme] = usePreference('theme');
  const [currency] = usePreference('analytics.currency');

  const list = Array.isArray(templates) ? templates : [];
  const available = list.filter((template) => !template.pending).length;
  const proposals = user.role === 'owner' ? list.filter((template) => template.pending).length : 0;
  const themeLabel = PREFERENCES.theme.options.find((option) => option.value === theme)?.label;

  const personal: RowData[] = [
    {
      to: '/settings/account',
      tone: 'account',
      icon: <UserIcon />,
      title: 'Аккаунт',
      subtitle: 'Имя, карта, пароль',
    },
    {
      to: '/settings/templates',
      tone: 'templates',
      icon: <BoltIcon size={20} />,
      title: 'Шаблоны расходов',
      value: String(available),
    },
    {
      to: '/settings/notifications',
      tone: 'notifications',
      icon: <BellIcon />,
      title: 'Уведомления',
      value: pushValue(push.status),
    },
    {
      to: '/settings/appearance',
      tone: 'appearance',
      icon: <PaletteIcon />,
      title: 'Оформление',
      value: themeLabel,
    },
    {
      to: '/settings/analytics',
      tone: 'analytics',
      icon: <ChartIcon />,
      title: 'Аналитика',
      value: String(currency),
    },
  ];

  const app: RowData[] = [
    ...(user.role === 'owner'
      ? [
          {
            to: '/group',
            tone: 'group' as const,
            icon: <UsersIcon />,
            title: 'Управление группой',
            subtitle: 'Участники, карты, категории',
            badge: proposals,
          },
        ]
      : []),
    ...(user.isAdmin
      ? [{ to: '/admin', tone: 'admin' as const, icon: <ShieldIcon />, title: 'Админ' }]
      : []),
  ];

  return { personal, app };
}

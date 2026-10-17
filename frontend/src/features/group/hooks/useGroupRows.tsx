import {
  BoltIcon,
  CreditCardIcon,
  DocumentIcon,
  LinkIcon,
  MegaphoneIcon,
  SettingsIcon,
  TagIcon,
  UsersIcon,
} from '../../../shared/ui/icons.tsx';
import type { RowGroup } from '../../../shared/sections/model.ts';
import { useApiKeys } from '../../integrations/hooks/useIntegrations.ts';
import { useTemplates } from '../../templates/hooks/useTemplates.ts';
import type { GroupOverview } from '../api/group.api.ts';

const keysLabel = (count: number) => {
  const last = count % 10;
  const teen = count % 100 >= 11 && count % 100 <= 14;
  const word = teen ? 'ключей' : last === 1 ? 'ключ' : last >= 2 && last <= 4 ? 'ключа' : 'ключей';
  return `${count} ${word}`;
};

/** The rows of the group hub and of the side menu, with the values the phone list shows. */
export function useGroupRows(data: GroupOverview): RowGroup[] {
  const { data: templates } = useTemplates();
  const keys = useApiKeys();
  const proposals = Array.isArray(templates)
    ? templates.filter((template) => template.pending).length
    : 0;
  const activeKeys = Array.isArray(keys.data)
    ? keys.data.filter((key) => !key.revokedAt).length
    : null;

  return [
    {
      menuLabel: 'Разделы группы',
      rows: [
        {
          to: '/group/general',
          tone: 'general',
          icon: <SettingsIcon />,
          title: 'Основные',
          subtitle: 'Название, валюта отчётов',
          value: data.group.reportingCurrency,
        },
        {
          to: '/group/members',
          tone: 'members',
          icon: <UsersIcon />,
          title: 'Участники и приглашения',
          value: String(data.members.length),
        },
        {
          to: '/group/cards',
          tone: 'cards',
          icon: <CreditCardIcon />,
          title: 'Карты',
          value: String(data.cards.filter((card) => !card.archived).length),
        },
        {
          to: '/group/categories',
          tone: 'categories',
          icon: <TagIcon />,
          title: 'Категории и лимиты',
          value: String(data.categories.filter((category) => !category.archived).length),
        },
        {
          to: '/group/templates',
          tone: 'templates',
          icon: <BoltIcon size={20} />,
          title: 'Шаблоны группы',
          badge: proposals,
          badgeSuffix: 'новых',
        },
        {
          to: '/group/receipts',
          tone: 'receipts',
          icon: <DocumentIcon />,
          title: 'Чеки и ИИ',
          subtitle: 'Фото чеков, разбор через ИИ',
        },
      ],
    },
    {
      label: 'Автоматизация',
      rows: [
        {
          to: '/group/integrations',
          tone: 'integrations',
          icon: <LinkIcon />,
          title: 'Интеграции',
          subtitle: 'API-ключи, журнал запросов',
          value: activeKeys === null ? undefined : keysLabel(activeKeys),
        },
        {
          to: '/group/broadcast',
          tone: 'broadcast',
          icon: <MegaphoneIcon />,
          title: 'Сообщение участникам',
        },
      ],
    },
  ];
}

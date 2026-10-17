export type SettingsSectionId =
  'account' | 'templates' | 'notifications' | 'appearance' | 'analytics';

export interface SectionInfo {
  id: SettingsSectionId;
  title: string;
}

export const SECTIONS: SectionInfo[] = [
  { id: 'account', title: 'Аккаунт' },
  { id: 'templates', title: 'Шаблоны расходов' },
  { id: 'notifications', title: 'Уведомления' },
  { id: 'appearance', title: 'Оформление' },
  { id: 'analytics', title: 'Аналитика' },
];

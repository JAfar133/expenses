import { PreferenceSwitch } from './PreferenceSwitch.tsx';
import { SettingsSection } from './SettingsSection.tsx';

/** «Оформление»: the theme of the app, personal for the user (not the group). */
export function AppearanceCard() {
  return (
    <SettingsSection title="Оформление" compact>
      <PreferenceSwitch prefKey="theme" label="Тема" />
    </SettingsSection>
  );
}

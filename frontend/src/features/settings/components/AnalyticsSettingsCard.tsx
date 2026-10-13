import { useState } from 'react';
import { ConfirmDialog } from '../../analytics/components/ConfirmDialog.tsx';
import { useSavePreferences, useSaveStatus } from '../../preferences/hooks/usePreferences.ts';
import { defaultPreferences } from '../../preferences/model/preferences.ts';
import { AnalyticsAccordion } from './AnalyticsAccordion.tsx';
import { PreferenceSwitch } from './PreferenceSwitch.tsx';
import { SettingsSection } from './SettingsSection.tsx';

/** «Настройки аналитики»: the display currency and the filter panel, then the charts in an accordion, then a reset. */
export function AnalyticsSettingsCard() {
  const { save } = useSavePreferences();
  const { isSaving, isError } = useSaveStatus();
  const [confirming, setConfirming] = useState(false);

  return (
    <SettingsSection title="Настройки аналитики" compact>
      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        Настройки отображения сохраняются в вашем аккаунте и действуют на всех устройствах
      </p>
      <PreferenceSwitch prefKey="analytics.currency" label="Валюта отображения" />
      <AnalyticsAccordion />

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => setConfirming(true)}
          disabled={isSaving}
          className="h-10 rounded-xl border border-zinc-300 px-4 text-sm font-medium hover:border-indigo-400 disabled:opacity-60 dark:border-zinc-700"
        >
          Сбросить настройки аналитики
        </button>
        {isError && (
          <span role="alert" className="text-sm text-red-600 dark:text-red-400">
            Не удалось сохранить на сервере: выбор сохранён только в этом браузере
          </span>
        )}
      </div>

      {confirming && (
        <ConfirmDialog
          title="Сбросить настройки аналитики?"
          message="Вернуть стандартные настройки отображения аналитики? Ваши расходы и бюджеты не изменятся."
          confirmLabel="Сбросить"
          onCancel={() => setConfirming(false)}
          onConfirm={() => {
            void save(defaultPreferences());
            setConfirming(false);
          }}
        />
      )}
    </SettingsSection>
  );
}

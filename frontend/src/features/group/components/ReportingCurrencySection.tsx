import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Notice } from '../../../shared/ui/Notice.tsx';
import { ConfirmDialog } from '../../analytics/components/ConfirmDialog.tsx';
import { SettingsSection } from '../../settings/components/SettingsSection.tsx';
import { setReportingCurrency } from '../api/group.api.ts';
import { toErrorMessage } from '../model/error-message.ts';
import { compactSelectClass } from './styles.ts';

interface ReportingCurrencySectionProps {
  current: string;
  currencies: string[];
}

/** The currency of the group's totals and charts; changing it recalculates the records (after a confirmation). */
export function ReportingCurrencySection({ current, currencies }: ReportingCurrencySectionProps) {
  const queryClient = useQueryClient();
  const [chosen, setChosen] = useState(current);
  const [confirming, setConfirming] = useState(false);

  const change = useMutation({
    retry: false,
    mutationFn: setReportingCurrency,
    // Totals change everywhere: refetch the group, analytics, the expense list and the configuration
    onSuccess: () => queryClient.invalidateQueries(),
  });

  async function confirm() {
    try {
      await change.mutateAsync(chosen);
    } catch {
      // The error is shown below
    }
    setConfirming(false);
  }

  return (
    <SettingsSection
      title="Валюта отчётности"
      hint="В этой валюте считаются итоги и графики группы. Карты могут быть в других валютах — их траты пересчитываются в эту валюту по курсу на момент траты."
    >
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 font-medium">{current}</span>
        {currencies.length > 1 && (
          <>
            <select
              aria-label="Новая валюта отчётности"
              value={chosen}
              onChange={(event) => setChosen(event.target.value)}
              className={`${compactSelectClass} h-11`}
            >
              {currencies.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={chosen === current || change.isPending}
              onClick={() => setConfirming(true)}
              className="h-11 shrink-0 rounded-lg border border-indigo-200 px-4 text-sm font-medium text-indigo-700 hover:bg-indigo-50 disabled:opacity-50 dark:border-indigo-900 dark:text-indigo-300 dark:hover:bg-indigo-950/60"
            >
              Изменить
            </button>
          </>
        )}
      </div>
      {change.isSuccess && (
        <Notice variant="success">Пересчитано трат: {change.data.recalculated}</Notice>
      )}
      {change.isError && <Notice variant="error">{toErrorMessage(change.error)}</Notice>}
      {confirming && (
        <ConfirmDialog
          title="Сменить валюту отчётности?"
          message={`Все суммы пересчитаются в ${chosen}: траты на картах в ${chosen} сохранят точные суммы, остальные пересчитаются по сегодняшнему курсу ЦБ. Это нельзя отменить.`}
          confirmLabel="Сменить"
          busy={change.isPending}
          onConfirm={() => void confirm()}
          onCancel={() => setConfirming(false)}
        />
      )}
    </SettingsSection>
  );
}

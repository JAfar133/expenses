import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Notice } from '../../../shared/ui/Notice.tsx';
import { ConfirmDialog } from '../../analytics/components/ConfirmDialog.tsx';
import { setReportingCurrency } from '../api/group.api.ts';
import { toErrorMessage } from '../model/error-message.ts';
import { SettingRow } from './SettingRow.tsx';
import { compactSelectClass } from './styles.ts';

/** The currency of the totals: choosing another one asks for a confirmation, then the server recalculates. */
export function ReportingCurrencyRow({
  current,
  currencies,
}: {
  current: string;
  currencies: string[];
}) {
  const queryClient = useQueryClient();
  const [pending, setPending] = useState<string | null>(null);

  const change = useMutation({
    retry: false,
    mutationFn: setReportingCurrency,
    // Totals change everywhere: refetch the group, analytics, the expense list and the configuration
    onSuccess: () => queryClient.invalidateQueries(),
  });

  async function confirm(currency: string) {
    try {
      await change.mutateAsync(currency);
    } catch {
      // The error is shown under the row
    }
    setPending(null);
  }

  return (
    <SettingRow
      title="Валюта отчётности"
      description="В ней считаются итоги и графики"
      below={
        <>
          {change.isSuccess && (
            <Notice variant="success">Пересчитано трат: {change.data.recalculated}</Notice>
          )}
          {change.isError && <Notice variant="error">{toErrorMessage(change.error)}</Notice>}
        </>
      }
    >
      {currencies.length > 1 ? (
        <select
          aria-label="Валюта отчётности"
          value={current}
          disabled={change.isPending}
          onChange={(event) => event.target.value !== current && setPending(event.target.value)}
          className={`${compactSelectClass} h-11 sm:h-10`}
        >
          {currencies.map((code) => (
            <option key={code} value={code}>
              {code}
            </option>
          ))}
        </select>
      ) : (
        <span className="text-sm font-medium">{current}</span>
      )}
      {pending && (
        <ConfirmDialog
          title="Сменить валюту отчётности?"
          message={`Все суммы пересчитаются в ${pending}: траты на картах в ${pending} сохранят точные суммы, остальные пересчитаются по сегодняшнему курсу ЦБ. Это нельзя отменить.`}
          confirmLabel="Сменить"
          busy={change.isPending}
          onConfirm={() => void confirm(pending)}
          onCancel={() => setPending(null)}
        />
      )}
    </SettingRow>
  );
}

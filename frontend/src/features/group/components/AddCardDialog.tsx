import { useState } from 'react';
import { createCard } from '../api/group.api.ts';
import { useGroupMutation } from '../hooks/useGroup.ts';
import { NameDialog } from './NameDialog.tsx';
import { compactSelectClass } from './styles.ts';

interface AddCardDialogProps {
  currencies: string[];
  /** The default currency of a new card */
  reportingCurrency: string;
  onClose: () => void;
}

/** A new card: the name and, when the group allows several currencies, the currency. */
export function AddCardDialog({ currencies, reportingCurrency, onClose }: AddCardDialogProps) {
  const [currency, setCurrency] = useState(reportingCurrency);
  const add = useGroupMutation(({ name, currency: code }: { name: string; currency?: string }) =>
    createCard(name, code),
  );

  return (
    <NameDialog
      title="Новая карта"
      label="Название карты"
      submitLabel="Добавить"
      onClose={onClose}
      onSubmit={(name) =>
        add.mutateAsync({ name, currency: currencies.length > 1 ? currency : undefined })
      }
      extra={
        currencies.length > 1 && (
          <select
            aria-label="Валюта новой карты"
            value={currency}
            onChange={(event) => setCurrency(event.target.value)}
            className={`${compactSelectClass} h-12 w-full`}
          >
            {currencies.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>
        )
      }
    />
  );
}

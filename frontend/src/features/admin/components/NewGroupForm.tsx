import { useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useRates } from '../../expenses/hooks/useRates.ts';
import { ErrorNotice } from '../../group/components/ErrorNotice.tsx';
import { LinkPanel } from '../../group/components/LinkPanel.tsx';
import { compactInputClass, compactSelectClass } from '../../group/components/styles.ts';
import { useAdminMutation } from '../hooks/useAdminMutation.ts';
import { createGroup } from '../api/admin.api.ts';
import { ADMIN_GROUPS_KEY } from '../hooks/useAdminGroups.ts';

type CreatedGroup = { name: string; token: string; expiresAt: string };

/** Creates a group and shows the one-time link for its first owner. */
export function NewGroupForm() {
  const queryClient = useQueryClient();
  const rates = useRates();
  const [name, setName] = useState('');
  const [currency, setCurrency] = useState('');
  const [created, setCreated] = useState<CreatedGroup | null>(null);
  const currencies = rates.data?.currencies ?? [];

  const create = useAdminMutation(createGroup, async (result, input) => {
    setCreated({ name: input.name, token: result.token, expiresAt: result.expiresAt });
    setName('');
    await queryClient.invalidateQueries({ queryKey: ADMIN_GROUPS_KEY });
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    if (name.trim() === '' || create.isPending) return;
    create.mutate({ name: name.trim(), ...(currency ? { currency } : {}) });
  }

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold">Новая группа</h3>
      <form onSubmit={submit} className="grid gap-2 sm:flex sm:flex-wrap">
        <input
          aria-label="Название новой группы"
          placeholder="Название группы"
          value={name}
          onChange={(event) => setName(event.target.value)}
          className={compactInputClass}
        />
        {currencies.length > 0 && (
          <select
            aria-label="Валюта отчётов"
            value={currency}
            onChange={(event) => setCurrency(event.target.value)}
            className={compactSelectClass}
          >
            <option value="">Валюта по умолчанию</option>
            {currencies.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>
        )}
        <button
          type="submit"
          disabled={create.isPending || name.trim() === ''}
          className="h-11 rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-60"
        >
          Создать группу
        </button>
      </form>
      {created && (
        <LinkPanel
          title={`Ссылка для владельца группы «${created.name}»`}
          token={created.token}
          expiresAt={created.expiresAt}
          onClose={() => setCreated(null)}
        />
      )}
      <ErrorNotice mutations={[create]} />
    </div>
  );
}

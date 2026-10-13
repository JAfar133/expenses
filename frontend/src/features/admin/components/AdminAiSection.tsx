import { useState } from 'react';
import { Notice } from '../../../shared/ui/Notice.tsx';
import { toErrorMessage } from '../../group/model/error-message.ts';
import { SettingsSection } from '../../settings/components/SettingsSection.tsx';
import { updateAdminAi, type AdminAi } from '../api/admin.api.ts';
import { useAdminAi, useRefreshAdminAi } from '../hooks/useAdminAi.ts';
import { useAdminMutation } from '../hooks/useAdminMutation.ts';
import { AiGroupsList } from './AiGroupsList.tsx';
import { AiKeyForm } from './AiKeyForm.tsx';
import { AiParamsForm } from './AiParamsForm.tsx';
import { AiStatusRow } from './AiStatusRow.tsx';
import { AiUsageTiles } from './AiUsageTiles.tsx';

function AiBody({ ai }: { ai: AdminAi }) {
  const refresh = useRefreshAdminAi();
  const [checkFailed, setCheckFailed] = useState(false);
  const toggle = useAdminMutation(updateAdminAi, refresh);

  return (
    <div className="space-y-5">
      <AiStatusRow
        ai={ai}
        lastCheckFailed={checkFailed}
        busy={toggle.isPending}
        onToggle={(enabled) => toggle.mutate({ enabled })}
      />
      {toggle.isError && <Notice variant="error">{toErrorMessage(toggle.error)}</Notice>}
      <AiKeyForm ai={ai} onChecked={setCheckFailed} />
      <AiParamsForm ai={ai} />
      <AiUsageTiles usage={ai.usage} />
      <AiGroupsList groups={ai.groups} commonLimit={ai.dailyLimit} />
    </div>
  );
}

/** The «ИИ (Gemini)» block of the administration page, as a short setup: status, key, parameters, use, groups. */
export function AdminAiSection() {
  const ai = useAdminAi();

  return (
    <SettingsSection
      title="ИИ (Gemini)"
      hint="Название, дата и позиции чека заполняются по фото. Ключ хранится на сервере и в ответах не возвращается."
    >
      {ai.isError && <Notice variant="error">{toErrorMessage(ai.error)}</Notice>}
      {ai.data && <AiBody ai={ai.data} />}
    </SettingsSection>
  );
}

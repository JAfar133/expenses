import { useState } from 'react';
import { Notice } from '../../../shared/ui/Notice.tsx';
import { toErrorMessage } from '../../group/model/error-message.ts';
import { SettingsSection } from '../../settings/components/SettingsSection.tsx';
import { updateAdminAi, type AdminAi } from '../api/admin.api.ts';
import { useAdminAi, useRefreshAdminAi } from '../hooks/useAdminAi.ts';
import { useAdminMutation } from '../hooks/useAdminMutation.ts';
import { AiKeyActions, MissingSecretsKey } from './AiKeyForm.tsx';
import { AiSettingsList } from './AiSettingsList.tsx';
import { AiStatusChip, AiSwitchRow } from './AiStatusRow.tsx';
import { AiUsageTiles } from './AiUsageTiles.tsx';

function AiBody({
  ai,
  onToggle,
  busy,
  editing,
  onEdit,
  onChecked,
}: {
  ai: AdminAi;
  onToggle: (enabled: boolean) => void;
  busy: boolean;
  editing: 'model' | 'limit' | 'key' | null;
  onEdit: (value: 'model' | 'limit' | 'key' | null) => void;
  onChecked: (failed: boolean) => void;
}) {
  return (
    <div className="space-y-4">
      <AiSwitchRow ai={ai} busy={busy} onToggle={onToggle} />
      {!ai.canStoreKey && <MissingSecretsKey />}
      <AiSettingsList ai={ai} editing={editing} onEdit={onEdit} />
      <AiKeyActions ai={ai} onReplace={() => onEdit('key')} onChecked={onChecked} />
      <AiUsageTiles usage={ai.usage} dailyLimit={ai.dailyLimit} />
    </div>
  );
}

/** The «ИИ (Gemini)» block of the administration page: the status chip in the title, the switch, the settings. */
export function AdminAiSection() {
  const ai = useAdminAi();
  const refresh = useRefreshAdminAi();
  const [checkFailed, setCheckFailed] = useState(false);
  const [editing, setEditing] = useState<'model' | 'limit' | 'key' | null>(null);
  const toggle = useAdminMutation(updateAdminAi, refresh);

  return (
    <SettingsSection
      title="ИИ (Gemini)"
      hint="Название, дата и позиции чека заполняются по фото. Ключ хранится на сервере и в ответах не возвращается."
      action={ai.data && <AiStatusChip ai={ai.data} lastCheckFailed={checkFailed} />}
    >
      {ai.isError && <Notice variant="error">{toErrorMessage(ai.error)}</Notice>}
      {toggle.isError && <Notice variant="error">{toErrorMessage(toggle.error)}</Notice>}
      {ai.data && (
        <AiBody
          ai={ai.data}
          busy={toggle.isPending}
          onToggle={(enabled) => toggle.mutate({ enabled })}
          editing={editing}
          onEdit={setEditing}
          onChecked={setCheckFailed}
        />
      )}
    </SettingsSection>
  );
}

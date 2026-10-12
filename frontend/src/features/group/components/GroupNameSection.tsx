import { SettingsSection } from '../../settings/components/SettingsSection.tsx';
import { renameGroup } from '../api/group.api.ts';
import { useGroupMutation } from '../hooks/useGroup.ts';
import { EditableRow } from './EditableRow.tsx';
import { ErrorNotice } from './ErrorNotice.tsx';

/** Group name with inline rename. */
export function GroupNameSection({ name }: { name: string }) {
  const rename = useGroupMutation(renameGroup);

  return (
    <SettingsSection title="Название группы" hint="Название видят все участники группы.">
      <ul>
        <EditableRow name={name} onRename={(next) => rename.mutateAsync(next)} />
      </ul>
      <ErrorNotice mutations={[rename]} />
    </SettingsSection>
  );
}

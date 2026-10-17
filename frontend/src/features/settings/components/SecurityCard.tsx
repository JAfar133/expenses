import { useState } from 'react';
import { Notice } from '../../../shared/ui/Notice.tsx';
import { ChangePasswordDialog } from './ChangePasswordDialog.tsx';
import { SettingsSection } from './SettingsSection.tsx';

/** «Безопасность»: the password row with a button; the change itself is in a window. */
export function SecurityCard() {
  const [open, setOpen] = useState(false);
  const [changed, setChanged] = useState(false);

  return (
    <SettingsSection title="Безопасность" embeddedTitle="label" compact>
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-medium">Пароль</div>
          <div className="text-sm tracking-widest text-zinc-500">••••••••</div>
        </div>
        <button
          type="button"
          onClick={() => {
            setChanged(false);
            setOpen(true);
          }}
          className="h-10 shrink-0 rounded-xl border border-zinc-300 px-4 text-sm font-medium hover:border-indigo-400 dark:border-zinc-700"
        >
          Изменить пароль
        </button>
      </div>
      {changed && (
        <Notice variant="success">Пароль изменён. На других устройствах вход завершён</Notice>
      )}
      {open && (
        <ChangePasswordDialog
          onClose={() => setOpen(false)}
          onChanged={() => {
            setOpen(false);
            setChanged(true);
          }}
        />
      )}
    </SettingsSection>
  );
}

import type { ReactNode } from 'react';
import { Notice } from '../../../shared/ui/Notice.tsx';
import {
  CheckIcon,
  CloseIcon,
  PauseIcon,
  RefreshIcon,
  WarningIcon,
} from '../../../shared/ui/icons.tsx';
import { toErrorMessage } from '../../group/model/error-message.ts';
import { SettingsSection } from '../../settings/components/SettingsSection.tsx';
import type { AdminBackup } from '../api/admin.api.ts';
import { hasBackupProblem, useAdminBackup } from '../hooks/useAdminBackup.ts';
import { RUN_ERROR_TEXT, formatAge, formatBackupMoment, formatSize } from '../model/backup.ts';

type Tone = 'ok' | 'warn' | 'bad' | 'none';

const PLATE: Record<Tone, string> = {
  ok: 'bg-emerald-50 text-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-100',
  warn: 'bg-amber-50 text-amber-900 dark:bg-amber-950 dark:text-amber-200',
  bad: 'bg-red-50 text-red-900 dark:bg-red-950/60 dark:text-red-100',
  none: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300',
};
const ROUND: Record<Tone, string> = {
  ok: 'bg-emerald-500 text-white',
  warn: 'bg-amber-500 text-white',
  bad: 'bg-red-500 text-white',
  none: 'bg-zinc-400 text-white',
};

interface Card {
  tone: Tone;
  icon: ReactNode;
  title: string;
  /** The second line: size and OneDrive */
  detail?: ReactNode;
  /** The file name, small and grey, under the plate */
  file?: string;
}

/** The state of the backup as a plate: a green one with a check mark when all is well, yellow, red or grey otherwise. */
function toCard(backup: AdminBackup): Card {
  const { state, lastSuccess, lastRun } = backup;

  if (state === 'ok' && lastSuccess) {
    return {
      tone: 'ok',
      icon: <CheckIcon />,
      title: `Последний бэкап: ${formatBackupMoment(lastSuccess.at)}`,
      detail: (
        <>
          {formatSize(lastSuccess.sizeBytes)}
          {lastSuccess.remote === 'ok' && ' · OneDrive'}
          {lastSuccess.remote === 'failed' && (
            <>
              {' · '}
              <span className="font-medium text-red-600 dark:text-red-400">OneDrive ✗</span>
            </>
          )}
        </>
      ),
      file: lastSuccess.file,
    };
  }
  if (state === 'stale') {
    return {
      tone: 'warn',
      icon: <WarningIcon />,
      title: lastSuccess
        ? `Нет свежей копии · последняя ${formatBackupMoment(lastSuccess.at)} (${formatAge(backup.ageHours)})`
        : 'Копий нет',
    };
  }
  if (state === 'failed') {
    const reason = RUN_ERROR_TEXT[lastRun?.error ?? ''] ?? RUN_ERROR_TEXT.unexpected;
    return {
      tone: 'bad',
      icon: <CloseIcon />,
      title: `Ошибка запуска: ${reason}${lastSuccess ? ` · последняя копия ${formatBackupMoment(lastSuccess.at)}` : ''}`,
    };
  }
  return {
    tone: 'none',
    icon: <PauseIcon />,
    title: backup.configured ? 'Нет данных' : 'Не настроено',
  };
}

/** State of the nightly database backup. Read-only: the copies themselves are made by a script on the server. */
export function BackupSection() {
  const query = useAdminBackup();
  const backup = query.data;
  const card = backup && toCard(backup);

  return (
    <SettingsSection
      title="Бэкап базы"
      hint={`Состояние ночного бэкапа базы. Красное: нет свежей копии (дольше ${backup?.maxAgeHours ?? 26} ч) или последний запуск закончился ошибкой.`}
    >
      {query.isError && <Notice variant="error">{toErrorMessage(query.error)}</Notice>}
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1 space-y-1.5">
          {card && (
            <div className={`flex items-center gap-3 rounded-xl px-3 py-2.5 ${PLATE[card.tone]}`}>
              <span
                className={`flex size-7 shrink-0 items-center justify-center rounded-full ${ROUND[card.tone]}`}
              >
                {card.icon}
              </span>
              <div className="min-w-0 text-sm">
                <p className="font-medium">{card.title}</p>
                {card.detail && <p className="text-xs opacity-80">{card.detail}</p>}
              </div>
            </div>
          )}
          {card?.file && (
            <p className="break-all text-xs text-zinc-500 dark:text-zinc-400">{card.file}</p>
          )}
          {backup && hasBackupProblem(backup.state) && (
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Проверьте на сервере: ./scripts/backup-db.sh · лог ~/backups/backup.log
            </p>
          )}
        </div>
        <button
          type="button"
          aria-label="Обновить"
          title="Обновить"
          aria-busy={query.isFetching}
          disabled={query.isFetching}
          onClick={() => void query.refetch()}
          className="flex size-10 shrink-0 items-center justify-center rounded-lg text-indigo-600 hover:bg-indigo-50 disabled:opacity-60 sm:size-9 dark:text-indigo-300 dark:hover:bg-indigo-950/60"
        >
          <span className={query.isFetching ? 'animate-spin' : undefined}>
            <RefreshIcon />
          </span>
        </button>
      </div>
    </SettingsSection>
  );
}

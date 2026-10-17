import { MegaphoneIcon } from '../../../shared/ui/icons.tsx';

/** How the message will look in the bell and on the phone: an icon, the title and the text. */
export function NotificationPreview({ title, text }: { title: string; text: string }) {
  return (
    <div className="space-y-1.5">
      <div className="text-xs font-semibold tracking-wide text-zinc-500 uppercase dark:text-zinc-400">
        Так это увидят
      </div>
      <div
        aria-label="Предпросмотр уведомления"
        role="group"
        className="flex items-start gap-3 rounded-xl border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-700 dark:bg-zinc-950"
      >
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-indigo-50 text-indigo-600 dark:bg-indigo-950 dark:text-indigo-300">
          <MegaphoneIcon />
        </span>
        <div className="min-w-0">
          <div className="text-sm font-semibold break-words">{title}</div>
          <div className="text-sm break-words whitespace-pre-line text-zinc-600 dark:text-zinc-300">
            {text || 'Текст сообщения'}
          </div>
        </div>
      </div>
    </div>
  );
}

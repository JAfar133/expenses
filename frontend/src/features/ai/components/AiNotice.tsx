/** Shown before the first photo is sent: where it goes. «Понятно» confirms and lets the parsing start. */
export function AiNotice({ onConfirm }: { onConfirm: () => void }) {
  return (
    <div
      role="note"
      className="flex items-center justify-between gap-3 rounded-xl bg-violet-50 px-3 py-2 text-sm text-violet-900 dark:bg-violet-950/50 dark:text-violet-200"
    >
      <span>Чек будет отправлен на разбор в Google (Gemini)</span>
      <button
        type="button"
        onClick={onConfirm}
        className="h-9 shrink-0 rounded-lg bg-violet-600 px-3 text-sm font-medium text-white hover:bg-violet-500"
      >
        Понятно
      </button>
    </div>
  );
}

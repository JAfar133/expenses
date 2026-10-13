import { SparkIcon } from '../../../shared/ui/icons.tsx';

export const AI_MARK_TEXT = 'Сгенерировано с помощью AI';

/** The small spark next to what the AI generated and nobody changed. */
export function AiMark() {
  return (
    <span
      role="img"
      aria-label={AI_MARK_TEXT}
      title={AI_MARK_TEXT}
      className="inline-flex shrink-0 align-middle text-violet-500 dark:text-violet-400"
    >
      <SparkIcon />
    </span>
  );
}

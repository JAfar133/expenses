import type { AdminAi } from '../api/admin.api.ts';

export type AiTone = 'grey' | 'yellow' | 'green' | 'red';

export interface AiStatusView {
  label: string;
  tone: AiTone;
}

/**
 * One line that says where the AI setup stands: no key, key without the switch, working, or the last check failed.
 * «Ошибка» appears only after a check that failed.
 */
export function aiStatusOf(
  ai: Pick<AdminAi, 'keyConfigured' | 'enabled'>,
  lastCheckFailed: boolean,
): AiStatusView {
  if (!ai.keyConfigured) return { label: 'Не настроено', tone: 'grey' };
  if (lastCheckFailed) return { label: 'Ошибка', tone: 'red' };
  if (!ai.enabled) return { label: 'Ключ задан, ИИ выключен', tone: 'yellow' };
  return { label: 'Работает', tone: 'green' };
}

/** The caption under the installation switch. */
export function switchCaption(ai: Pick<AdminAi, 'keyConfigured' | 'enabled'>): string {
  if (!ai.keyConfigured) return 'Сначала задайте ключ';
  return ai.enabled ? 'Включено' : 'Выключено';
}

/** How many receipts a group may parse today: its own limit, or the common one. */
export const groupLimit = (own: number | null, common: number) => own ?? common;

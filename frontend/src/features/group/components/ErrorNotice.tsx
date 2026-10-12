import { Notice } from '../../../shared/ui/Notice.tsx';
import { toErrorMessage } from '../model/error-message.ts';

/** Shows the server's message for a failed mutation; nothing while there is no error. */
export function ErrorNotice({ mutations }: { mutations: { isError: boolean; error: unknown }[] }) {
  const failed = mutations.find((mutation) => mutation.isError);
  if (!failed) return null;
  return <Notice variant="error">{toErrorMessage(failed.error)}</Notice>;
}

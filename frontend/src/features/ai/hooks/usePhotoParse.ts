import { useCallback, useRef, useState } from 'react';
import { parseReceiptPhoto, type PhotoParse } from '../api/ai.api.ts';
import { parseFailureMessage } from '../model/parse-runner.ts';

export type PhotoParseState =
  | { status: 'idle' }
  | { status: 'running' }
  | { status: 'done'; result: PhotoParse }
  | { status: 'error'; message: string };

/**
 * Parsing of the attached photo before the expense is saved. `onResult` is called as soon as the answer comes
 * (before the status changes), so the form can fill itself in the same step. A new photo or a reset makes an
 * older answer obsolete. `wait()` resolves when the running parse is over, whatever the outcome.
 */
export function usePhotoParse(onResult: (result: PhotoParse) => void) {
  const [state, setState] = useState<PhotoParseState>({ status: 'idle' });
  const token = useRef(0);
  const last = useRef<{ photo: Blob; category: string } | null>(null);
  const waiters = useRef<(() => void)[]>([]);
  const onResultRef = useRef(onResult);
  onResultRef.current = onResult;

  const settle = () => waiters.current.splice(0).forEach((resolve) => resolve());

  const start = useCallback(async (photo: Blob, category: string) => {
    const mine = ++token.current;
    last.current = { photo, category };
    setState({ status: 'running' });
    try {
      const result = await parseReceiptPhoto(photo, category);
      if (mine !== token.current) return;
      onResultRef.current(result);
      setState({ status: 'done', result });
    } catch (error) {
      if (mine !== token.current) return;
      setState({ status: 'error', message: parseFailureMessage(error) });
    }
    settle();
  }, []);

  const reset = useCallback(() => {
    token.current += 1;
    last.current = null;
    setState({ status: 'idle' });
    settle();
  }, []);

  const retry = useCallback(
    (category?: string) => {
      // The category may have changed since: the caller passes the current one
      if (last.current) void start(last.current.photo, category ?? last.current.category);
    },
    [start],
  );

  const wait = useCallback(() => new Promise<void>((resolve) => waiters.current.push(resolve)), []);

  return { state, start, reset, retry, wait };
}

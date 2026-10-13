import { useEffect } from 'react';
import { Notice } from '../../../shared/ui/Notice.tsx';
import { dismissParseResult, useParseState } from '../model/parse-state.ts';

const RESULT_VISIBLE_MS = 8000;

/** On the «Добавить» page: a calm status of the background parsing, which never blocks the next expense. */
export function ParseNotices() {
  const { running, last } = useParseState();

  useEffect(() => {
    if (!last) return;
    const timer = setTimeout(dismissParseResult, RESULT_VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [last]);

  return (
    <>
      {running.length > 0 && <Notice variant="info">ИИ обрабатывает чек…</Notice>}
      {last && <Notice variant={last.kind === 'ok' ? 'success' : 'info'}>{last.message}</Notice>}
    </>
  );
}

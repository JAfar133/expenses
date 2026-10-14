import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react';
import type { UseFormReturn } from 'react-hook-form';
import { clearDraft, loadDraft, saveDraft } from '../../offline-queue/model/draft-store.ts';
import type { DraftItem } from '../../items/model/draft-items.ts';
import { isEmptyDraft, type DraftAiState, type FormDraftData } from '../model/form-draft.ts';
import type { ExpenseFormValues } from '../schemas/expense-form.schema.ts';

export const DRAFT_SAVE_DELAY_MS = 400;

interface Options {
  username: string;
  form: UseFormReturn<ExpenseFormValues>;
  items: DraftItem[];
  setItems: Dispatch<SetStateAction<DraftItem[]>>;
  photo: Blob | null;
  setPhoto: (photo: Blob | null) => void;
  dateTouched: MutableRefObject<boolean>;
  ai: {
    snapshot: DraftAiState;
    restore: (saved: DraftAiState, photo: Blob | undefined) => void;
    clearMarks: () => void;
  };
  /** An expense taken back from the offline queue is on the form: the stored draft is not brought back over it */
  blocked: boolean;
}

/**
 * The unsaved «Добавить» form survives the app being minimised, a reload of the page and a return from the camera:
 * it is kept in IndexedDB (with the photo) shortly after every change and at once when the page is hidden, and is
 * brought back when the form opens. It is dropped after the expense is saved, on «Очистить», on sign-out and after a day.
 */
export function useFormDraft({
  username,
  form,
  items,
  setItems,
  photo,
  setPhoto,
  dateTouched,
  ai,
  blocked,
}: Options) {
  const [restored, setRestored] = useState(false);
  // Saving starts only after the stored draft has been looked at: an empty form must not erase it
  const [loaded, setLoaded] = useState(false);

  const snapshot = (): FormDraftData => ({
    values: form.getValues(),
    items,
    dateTouched: dateTouched.current,
    ...(photo ? { photo } : {}),
    ai: ai.snapshot,
  });
  const latest = useRef(snapshot);
  latest.current = snapshot;
  const enabled = useRef(false);
  enabled.current = loaded;

  const flush = useCallback(() => {
    if (!enabled.current) return;
    const data = latest.current();
    void (isEmptyDraft(data) ? clearDraft(username) : saveDraft(username, data));
  }, [username]);

  // Bring the draft back once
  useEffect(() => {
    if (blocked) {
      setLoaded(true);
      return;
    }
    let cancelled = false;
    void loadDraft(username).then((stored) => {
      if (cancelled) return;
      const pristine = !form.getValues('name').trim() && !form.getValues('amount').trim();
      if (stored && pristine && !isEmptyDraft(stored.data)) {
        const { data } = stored;
        // The defaults stay as they were: «Очистить» goes back to them
        form.reset(data.values, { keepDefaultValues: true });
        setItems(data.items);
        dateTouched.current = data.dateTouched;
        setPhoto(data.photo ?? null);
        ai.restore(data.ai, data.photo);
        setRestored(true);
      }
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
    // Once per opening of the form
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Save shortly after a change; a new or removed photo at once (the camera may reload the page right after)
  const values = form.watch();
  const changeKey = JSON.stringify([values, items, dateTouched.current, ai.snapshot]);
  const lastPhoto = useRef<Blob | null>(null);
  useEffect(() => {
    if (!loaded) return;
    const photoChanged = photo !== lastPhoto.current;
    lastPhoto.current = photo;
    const timer = setTimeout(flush, photoChanged ? 0 : DRAFT_SAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [changeKey, photo, loaded, flush]);

  // On a phone the moment the page is hidden is the only reliable one
  useEffect(() => {
    const onHidden = () => document.visibilityState === 'hidden' && flush();
    document.addEventListener('visibilitychange', onHidden);
    window.addEventListener('pagehide', flush);
    return () => {
      document.removeEventListener('visibilitychange', onHidden);
      window.removeEventListener('pagehide', flush);
    };
  }, [flush]);

  return {
    restored,
    /** The expense is saved (or queued): the draft is done */
    markSaved: () => {
      setRestored(false);
      void clearDraft(username);
    },
    /** «Очистить»: forget the draft and empty the form */
    discard: () => {
      setRestored(false);
      void clearDraft(username);
      form.reset();
      setItems([]);
      setPhoto(null);
      dateTouched.current = false;
      ai.clearMarks();
    },
  };
}

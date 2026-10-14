import { NavLink, useLocation, useNavigate } from 'react-router';
import { useAiPhotoFirst } from '../../ai/hooks/useAiPhotoFirst.ts';
import { useAnyModalOpen } from '../../../shared/hooks/useScrollLock.ts';
import { useKeyboardOpen } from '../../../shared/hooks/useKeyboardOpen.ts';
import { CameraIcon, ChartIcon, PlusIcon } from '../../../shared/ui/icons.tsx';
import { usePhotoFile } from '../hooks/usePhotoFile.ts';
import { setPendingPhoto } from '../model/pending-photo.ts';
import { PhotoInput } from './PhotoInput.tsx';

/** Pages that have the button: «Добавить» and the analytics. */
export const fabPage = (pathname: string) => pathname === '/' || pathname.startsWith('/analytics');

/** Does this page have the camera button now: the photo-first scenario is possible and the page is one of those. */
export function useCameraFabAvailable(): boolean {
  const { pathname } = useLocation();
  const photoFirst = useAiPhotoFirst();
  return photoFirst && fabPage(pathname);
}

const itemClass = ({ isActive }: { isActive: boolean }) =>
  'flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-medium ' +
  (isActive
    ? 'text-indigo-600 dark:text-indigo-400'
    : 'text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-100');

/**
 * The bottom bar on phones: «Добавить» at the left, «Аналитика» at the right and between them the round camera button
 * on a hump that grows out of the bar (a receipt first, the AI fills in the rest; the system sheet offers the camera or the gallery). It exists only where the
 * «photo first» scenario is possible, hides while the keyboard or a window is open, and takes the photo to the
 * «Добавить» page through the pending-photo store.
 */
export function CameraFab() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const available = useCameraFabAvailable();
  const keyboard = useKeyboardOpen();
  const modal = useAnyModalOpen();
  const file = usePhotoFile((photo) => {
    setPendingPhoto(photo);
    if (pathname !== '/') navigate('/');
  });

  if (!available) return null;
  const hidden = keyboard || modal;

  return (
    <div className="md:hidden">
      <PhotoInput
        inputRef={file.input}
        onChange={(event) => void file.onChange(event)}
        label="Снять чек"
      />
      {hidden ? null : (
        <>
          {file.error && (
            <p
              role="alert"
              className="fixed inset-x-4 bottom-[calc(env(safe-area-inset-bottom)+6.5rem)] z-30 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800 shadow dark:bg-red-950 dark:text-red-200"
            >
              {file.error}
            </p>
          )}
          <nav
            aria-label="Нижняя навигация"
            className="fixed inset-x-0 bottom-0 z-30 border-t border-zinc-200 bg-white pb-[env(safe-area-inset-bottom)] shadow-[0_-4px_12px_rgba(0,0,0,0.06)] dark:border-zinc-800 dark:bg-zinc-900"
          >
            {/* The hump: the top half of a circle in the colour of the bar, so the edge goes around the button */}
            <div
              aria-hidden="true"
              className="absolute left-1/2 top-[-33px] h-[34px] w-[86px] -translate-x-1/2 overflow-hidden"
            >
              <div className="size-[86px] rounded-full border border-zinc-200 bg-white shadow-[0_-4px_12px_rgba(0,0,0,0.06)] dark:border-zinc-800 dark:bg-zinc-900" />
            </div>
            <div className="relative grid h-14 grid-cols-[1fr_5.5rem_1fr]">
              <NavLink to="/" end className={itemClass}>
                <span className="[&>svg]:size-[22px]">
                  <PlusIcon />
                </span>
                Добавить
              </NavLink>
              <button
                type="button"
                aria-label="Добавить чек (камера или галерея)"
                title="Добавить чек (камера или галерея)"
                disabled={file.busy}
                onClick={file.open}
                className="absolute left-1/2 top-[-22px] z-10 flex size-16 -translate-x-1/2 items-center justify-center rounded-full bg-indigo-600 text-white shadow-lg hover:bg-indigo-500 disabled:opacity-60 [&>svg]:size-7"
              >
                <CameraIcon />
              </button>
              <span aria-hidden="true" />
              <NavLink to="/analytics" className={itemClass}>
                <span className="[&>svg]:size-[22px]">
                  <ChartIcon />
                </span>
                Аналитика
              </NavLink>
            </div>
          </nav>
        </>
      )}
    </div>
  );
}

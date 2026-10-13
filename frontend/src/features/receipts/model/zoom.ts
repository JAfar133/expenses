export const MIN_SCALE = 1;
export const MAX_SCALE = 5;
/** What a double tap zooms to. */
export const TAP_SCALE = 2.5;
const STEP = 1.5;

export interface View {
  scale: number;
  x: number;
  y: number;
}

export const FIT: View = { scale: 1, x: 0, y: 0 };

export const clampScale = (scale: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));

/** The photo cannot be dragged out of the window: at most half of the extra size on each side. */
export function clampView(view: View, width: number, height: number): View {
  const scale = clampScale(view.scale);
  if (scale === MIN_SCALE) return FIT;
  const limitX = (width * (scale - 1)) / 2;
  const limitY = (height * (scale - 1)) / 2;
  return {
    scale,
    x: Math.min(limitX, Math.max(-limitX, view.x)),
    y: Math.min(limitY, Math.max(-limitY, view.y)),
  };
}

export const zoomBy = (view: View, factor: number, width: number, height: number) =>
  clampView({ ...view, scale: view.scale * factor }, width, height);

export const zoomIn = (view: View, width: number, height: number) =>
  zoomBy(view, STEP, width, height);

export const zoomOut = (view: View, width: number, height: number) =>
  zoomBy(view, 1 / STEP, width, height);

/** Double tap: fit <-> zoomed in. */
export const toggleZoom = (view: View): View =>
  view.scale > MIN_SCALE ? FIT : { scale: TAP_SCALE, x: 0, y: 0 };

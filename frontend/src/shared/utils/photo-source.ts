export interface PhotoEnvironment {
  userAgent: string;
  platform: string;
  maxTouchPoints: number;
  /** A phone-sized screen or a touch pointer */
  touch: boolean;
}

/** iPhone, iPad, iPod and iPadOS (which calls itself a Mac but has a touch screen). */
export const isIos = ({ userAgent, platform, maxTouchPoints }: PhotoEnvironment) =>
  /iPhone|iPad|iPod/.test(userAgent) || (platform === 'MacIntel' && maxTouchPoints > 1);

export const isSamsungBrowser = ({ userAgent }: PhotoEnvironment) =>
  /SamsungBrowser/.test(userAgent);

/**
 * Does the app have to ask «Сфотографировать / Выбрать из галереи» itself: on touch devices, except iOS and Samsung
 * Internet, where a plain file input already shows the system choice (camera, gallery, files). Chrome and Firefox on
 * Android open only the gallery for it.
 */
export function needsPhotoMenu(environment: PhotoEnvironment): boolean {
  return environment.touch && !isIos(environment) && !isSamsungBrowser(environment);
}

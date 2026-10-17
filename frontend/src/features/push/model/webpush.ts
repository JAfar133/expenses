/** Pure and browser helpers of Web Push. Nothing here talks to the server. */

/** The public key of the server (base64url) as the bytes `pushManager.subscribe` wants. */
export function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4))
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  const raw = atob(padded);
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
}

export const isIos = (
  ua = navigator.userAgent,
  platform = navigator.platform,
  touchPoints = navigator.maxTouchPoints,
) => /iPhone|iPad|iPod/.test(ua) || (platform === 'MacIntel' && touchPoints > 1);

/** The app is opened from the home screen (or installed), not in a browser tab. */
export const isStandalone = () =>
  (navigator as Navigator & { standalone?: boolean }).standalone === true ||
  globalThis.matchMedia?.('(display-mode: standalone)')?.matches === true;

/** The browser can do Web Push at all. */
export const pushSupported = () =>
  'serviceWorker' in navigator && 'PushManager' in globalThis && 'Notification' in globalThis;

/** «iPhone · Safari (приложение)», «Chrome · Windows»: what the person recognises in the list of devices. */
export function deviceLabel(
  ua = navigator.userAgent,
  standalone = isStandalone(),
  platform = navigator.platform,
  touchPoints = navigator.maxTouchPoints,
): string {
  const ios = isIos(ua, platform, touchPoints);
  const os =
    /iPad/.test(ua) || (ios && !/iPhone|iPod/.test(ua))
      ? 'iPad'
      : /iPhone|iPod/.test(ua)
        ? 'iPhone'
        : /Android/.test(ua)
          ? 'Android'
          : /Windows/.test(ua)
            ? 'Windows'
            : /Mac OS X|Macintosh/.test(ua)
              ? 'Mac'
              : /Linux/.test(ua)
                ? 'Linux'
                : 'Устройство';
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /Firefox|FxiOS/.test(ua)
      ? 'Firefox'
      : /CriOS|Chrome\//.test(ua)
        ? 'Chrome'
        : /Safari\//.test(ua)
          ? 'Safari'
          : 'Браузер';
  const label = ios ? `${os} · ${browser}` : `${browser} · ${os}`;
  return standalone ? `${label} (приложение)` : label;
}

/** A short stable key of a subscription address: the address itself is a secret and is not stored. */
export function endpointKey(endpoint: string): string {
  let hash = 2166136261;
  for (let i = 0; i < endpoint.length; i += 1) {
    hash = Math.imul(hash ^ endpoint.charCodeAt(i), 16777619);
  }
  return (hash >>> 0).toString(36);
}

const idKey = (endpoint: string) => `push.device.${endpointKey(endpoint)}`;

/** The server's id of this browser's subscription, kept per address; it marks «это устройство» in the list. */
export const storedDeviceId = (endpoint: string): string | null => {
  try {
    return localStorage.getItem(idKey(endpoint));
  } catch {
    return null;
  }
};
export const rememberDeviceId = (endpoint: string, id: string) => {
  try {
    localStorage.setItem(idKey(endpoint), id);
  } catch {
    // Without storage the device is simply not marked
  }
};
export const forgetDeviceId = (endpoint: string) => {
  try {
    localStorage.removeItem(idKey(endpoint));
  } catch {
    // Nothing to forget
  }
};

/** The subscription of this browser, if there is one. */
export async function currentSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  try {
    const registration = await navigator.serviceWorker.getRegistration();
    return (await registration?.pushManager.getSubscription()) ?? null;
  } catch {
    return null;
  }
}

/** Do the bytes of two keys match? Used to notice that the server's key changed. */
export function sameKey(a: ArrayBuffer | null | undefined, b: Uint8Array): boolean {
  if (!a) return false;
  const left = new Uint8Array(a);
  return left.length === b.length && left.every((value, index) => value === b[index]);
}

/*
 * Service worker of the app: Web Push only. No fetch handler and no cache (it must never get in the way of updates).
 * Every push MUST show a notification: iOS revokes a subscription that receives pushes without a visible one.
 */

/** Only a path inside the app is opened: anything else (another site, a script) becomes the start page. */
function safePath(url) {
  return typeof url === 'string' && url.startsWith('/') && !url.startsWith('//') ? url : '/';
}

function toKey(base64) {
  const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4))
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  const raw = atob(padded);
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
}

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = {};
  }
  const title = typeof payload.title === 'string' && payload.title ? payload.title : 'Расходы';
  const options = {
    body: typeof payload.body === 'string' ? payload.body : '',
    tag: payload.id,
    data: { url: safePath(payload.url), id: payload.id },
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    timestamp: payload.ts,
  };

  event.waitUntil(
    (async () => {
      await self.registration.showNotification(title, options);
      // The number on the icon, where the platform has it; a failure here never hides the notification
      try {
        const unread = Number(payload.unread);
        if (Number.isFinite(unread)) {
          if (unread > 0) await self.navigator.setAppBadge?.(unread);
          else await self.navigator.clearAppBadge?.();
        }
      } catch {
        // The badge is a convenience
      }
    })(),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = safePath(event.notification.data && event.notification.data.url);

  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const existing = windows[0];
      if (!existing) {
        await self.clients.openWindow(url);
        return;
      }
      try {
        await existing.navigate(url);
      } catch {
        // Some platforms cannot navigate a window from here: the app itself follows the message
        existing.postMessage({ type: 'navigate', url });
      }
      await existing.focus();
    })(),
  );
});

self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(
    (async () => {
      try {
        let subscription = event.newSubscription;
        if (!subscription) {
          let key =
            event.oldSubscription && event.oldSubscription.options
              ? event.oldSubscription.options.applicationServerKey
              : null;
          if (!key) {
            const config = await (
              await fetch('/api/push/config', { credentials: 'include' })
            ).json();
            key = toKey(config.data.publicKey);
          }
          subscription = await self.registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: key,
          });
        }
        const json = subscription.toJSON();
        await fetch('/api/push/subscriptions', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys }),
        });
      } catch {
        // The person can switch the notifications on again in the settings
      }
    })(),
  );
});

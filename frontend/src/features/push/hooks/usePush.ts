import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';
import { ApiError } from '../../../shared/api/http.ts';
import {
  createPushSubscription,
  deletePushDevice,
  fetchNotificationSettings,
  fetchPushConfig,
  fetchPushDevices,
  saveNotificationSettings,
  type NotificationSettings,
  type NotificationSettingsPatch,
} from '../api/push.api.ts';
import {
  currentSubscription,
  deviceLabel,
  forgetDeviceId,
  isIos,
  isStandalone,
  pushSupported,
  rememberDeviceId,
  sameKey,
  storedDeviceId,
  urlBase64ToUint8Array,
} from '../model/webpush.ts';

const CONFIG_KEY = ['push', 'config'];
const DEVICES_KEY = ['push', 'devices'];
const SETTINGS_KEY = ['push', 'settings'];

export type PushStatus =
  'loading' | 'server-off' | 'needs-install' | 'unsupported' | 'denied' | 'off' | 'on';

export const usePushConfig = () =>
  useQuery({ queryKey: CONFIG_KEY, queryFn: fetchPushConfig, retry: false, staleTime: 5 * 60_000 });

export const usePushDevices = (enabled = true) =>
  useQuery({ queryKey: DEVICES_KEY, queryFn: fetchPushDevices, retry: false, enabled });

/** Registers the service worker once the server has Web Push; failures are silent (nothing to show to anyone). */
export function useRegisterServiceWorker(onNavigate: (url: string) => void) {
  const { data: config } = usePushConfig();
  useEffect(() => {
    if (!config?.enabled || !pushSupported()) return;
    void navigator.serviceWorker.register('/sw.js').catch(() => undefined);
    // A click on a notification asks an open window to go to the page when it cannot be navigated from outside
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type?: string; url?: string } | null;
      if (data?.type === 'navigate' && typeof data.url === 'string' && data.url.startsWith('/')) {
        onNavigate(data.url);
      }
    };
    navigator.serviceWorker.addEventListener?.('message', onMessage);
    return () => navigator.serviceWorker.removeEventListener?.('message', onMessage);
    // The navigate function of the router is stable enough for this
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config?.enabled]);
}

/**
 * The state of THIS device: server without Web Push, a browser tab of iPhone that is not installed, no APIs, denied,
 * off or on. «on» means the browser has a subscription and the server lists it. A subscription that the server does
 * not know (the list was lost) is sent again; one made with another server key is replaced.
 */
export function usePushStatus() {
  const queryClient = useQueryClient();
  const config = usePushConfig();
  const devices = usePushDevices(config.data?.enabled === true);
  const [subscription, setSubscription] = useState<PushSubscription | null | undefined>(undefined);
  const [permission, setPermission] = useState<NotificationPermission | null>(() =>
    'Notification' in globalThis ? Notification.permission : null,
  );

  const refresh = useCallback(async () => {
    setSubscription(await currentSubscription());
    setPermission('Notification' in globalThis ? Notification.permission : null);
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const publicKey = config.data?.publicKey ?? null;
  // Self-healing: re-register a subscription the server does not list, replace one made with an old server key
  useEffect(() => {
    if (!subscription || !publicKey || !devices.isSuccess) return;
    const key = urlBase64ToUint8Array(publicKey);
    let cancelled = false;
    void (async () => {
      try {
        if (!sameKey(subscription.options?.applicationServerKey, key)) {
          await subscription.unsubscribe();
          forgetDeviceId(subscription.endpoint);
          const registration = await navigator.serviceWorker.ready;
          const fresh = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: key,
          });
          const id = await register(fresh);
          if (cancelled) return;
          rememberDeviceId(fresh.endpoint, id);
          setSubscription(fresh);
          void queryClient.invalidateQueries({ queryKey: DEVICES_KEY });
          return;
        }
        const known = storedDeviceId(subscription.endpoint);
        if (!known || !devices.data.some((device) => device.id === known)) {
          const id = await register(subscription);
          rememberDeviceId(subscription.endpoint, id);
          if (!cancelled) void queryClient.invalidateQueries({ queryKey: DEVICES_KEY });
        }
      } catch {
        // The person can switch it on again by hand
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [subscription, publicKey, devices.isSuccess, devices.data, queryClient]);

  const known = subscription ? storedDeviceId(subscription.endpoint) : null;
  const status: PushStatus = !config.isSuccess
    ? 'loading'
    : !config.data.enabled
      ? 'server-off'
      : isIos() && !isStandalone()
        ? 'needs-install'
        : !pushSupported()
          ? 'unsupported'
          : permission === 'denied'
            ? 'denied'
            : subscription === undefined
              ? 'loading'
              : subscription && known && devices.data?.some((device) => device.id === known)
                ? 'on'
                : subscription && !devices.isSuccess
                  ? 'loading'
                  : subscription
                    ? 'on'
                    : 'off';

  return { status, subscription, deviceId: known, refresh, publicKey, devices };
}

async function register(subscription: PushSubscription): Promise<string> {
  const json = subscription.toJSON();
  const keys = json.keys;
  if (!json.endpoint || !keys?.p256dh || !keys.auth) throw new Error('Подписка без ключей');
  const { id } = await createPushSubscription({
    endpoint: json.endpoint,
    keys: { p256dh: keys.p256dh, auth: keys.auth },
    label: deviceLabel(),
  });
  return id;
}

/** The message for a failed «Включить»: the server's own words when it said no, a clear text otherwise. */
function enableError(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return 'Не удалось подключить уведомления на этом устройстве. Попробуйте ещё раз';
}

/** Switching this device on and off and removing a device. */
export function usePushActions(onChanged: () => Promise<void>) {
  const queryClient = useQueryClient();
  const refreshDevices = () => queryClient.invalidateQueries({ queryKey: DEVICES_KEY });

  /**
   * Must run inside the click handler: the permission prompt needs the tap, so `requestPermission` is the first
   * thing that happens (nothing is awaited before it).
   */
  const enable = useMutation<void, Error, string>({
    retry: false,
    mutationFn: async (publicKey) => {
      const permission = await Notification.requestPermission();
      if (permission === 'denied') {
        throw new Error(
          'Разрешение отклонено. Его можно выдать в настройках браузера или телефона',
        );
      }
      if (permission !== 'granted') {
        throw new Error('Разрешение не получено. Нажмите кнопку ещё раз и выберите «Разрешить»');
      }
      const registration = await navigator.serviceWorker
        .register('/sw.js')
        .then(() => navigator.serviceWorker.ready);
      let subscription: PushSubscription;
      try {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey),
        });
      } catch {
        throw new Error(
          'Браузер не смог создать подписку. Проверьте, что уведомления разрешены, и попробуйте ещё раз',
        );
      }
      try {
        rememberDeviceId(subscription.endpoint, await register(subscription));
      } catch (error) {
        // Do not leave a subscription the server does not know
        await subscription.unsubscribe().catch(() => undefined);
        throw new Error(enableError(error));
      }
    },
    onSettled: async () => {
      await refreshDevices();
      await onChanged();
    },
  });

  const disableThisDevice = useMutation({
    retry: false,
    mutationFn: async (id: string | null) => {
      const subscription = await currentSubscription();
      if (id) await deletePushDevice(id).catch(() => undefined);
      if (subscription) {
        forgetDeviceId(subscription.endpoint);
        await subscription.unsubscribe();
      }
    },
    onSettled: async () => {
      await refreshDevices();
      await onChanged();
    },
  });

  const removeDevice = useMutation({
    retry: false,
    mutationFn: async ({ id, thisDevice }: { id: string; thisDevice: boolean }) => {
      await deletePushDevice(id);
      if (thisDevice) {
        const subscription = await currentSubscription();
        if (subscription) {
          forgetDeviceId(subscription.endpoint);
          await subscription.unsubscribe().catch(() => undefined);
        }
      }
    },
    onSettled: async () => {
      await refreshDevices();
      await onChanged();
    },
  });

  return { enable, disableThisDevice, removeDevice };
}

/** «Что присылать» and the privacy choice; a change shows at once and an error puts the old value back. */
export function useNotificationSettings() {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: SETTINGS_KEY,
    queryFn: fetchNotificationSettings,
    retry: false,
  });
  const save = useMutation<
    unknown,
    Error,
    NotificationSettingsPatch,
    { previous?: NotificationSettings }
  >({
    retry: false,
    mutationFn: saveNotificationSettings,
    onMutate: async (patch) => {
      await queryClient.cancelQueries({ queryKey: SETTINGS_KEY });
      const previous = queryClient.getQueryData<NotificationSettings>(SETTINGS_KEY);
      if (previous) {
        queryClient.setQueryData<NotificationSettings>(SETTINGS_KEY, {
          push: {
            types: { ...previous.push.types, ...patch.push?.types },
            hideAmounts: patch.push?.hideAmounts ?? previous.push.hideAmounts,
          },
        });
      }
      return { previous };
    },
    onError: (_error, _patch, context) => {
      if (context?.previous) queryClient.setQueryData(SETTINGS_KEY, context.previous);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: SETTINGS_KEY }),
  });
  return { query, save };
}

/**
 * Before signing out: this browser's subscription is removed on the server and in the browser, so that somebody at a
 * shared device does not get the next person's notifications. Best effort, and it never holds the logout for long.
 */
export async function unsubscribeThisDevice(): Promise<void> {
  const work = (async () => {
    const subscription = await currentSubscription();
    if (!subscription) return;
    const { endpoint } = subscription;
    const { unsubscribePush } = await import('../api/push.api.ts');
    await unsubscribePush(endpoint).catch(() => undefined);
    forgetDeviceId(endpoint);
    await subscription.unsubscribe().catch(() => undefined);
  })().catch(() => undefined);
  await Promise.race([work, new Promise<void>((resolve) => setTimeout(resolve, 2000))]);
}

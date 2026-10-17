import { createECDH, randomBytes } from 'node:crypto';
import webpush from 'web-push';
import { describe, expect, it } from 'vitest';
import { WebPushSender } from '../../src/modules/push/web-push.sender.ts';

/** A browser subscription as the browser would make it (a real P-256 key and an auth secret). */
const subscription = () => {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  return {
    endpoint: 'https://fcm.googleapis.com/fcm/send/test',
    keys: {
      p256dh: ecdh.getPublicKey().toString('base64url'),
      auth: randomBytes(16).toString('base64url'),
    },
  };
};

describe('отправитель Web Push', () => {
  const keys = webpush.generateVAPIDKeys();

  it('на старте проверяет ключи и адрес отправителя', () => {
    expect(
      () =>
        new WebPushSender({
          publicKey: keys.publicKey,
          privateKey: keys.privateKey,
          subject: 'mailto:me@example.com',
        }),
    ).not.toThrow();
    expect(
      () =>
        new WebPushSender({
          publicKey: 'мусор',
          privateKey: 'мусор',
          subject: 'mailto:me@example.com',
        }),
    ).toThrow();
    expect(
      () =>
        new WebPushSender({
          publicKey: keys.publicKey,
          privateKey: keys.privateKey,
          subject: 'не адрес',
        }),
    ).toThrow();
  });

  it('сообщение шифруется для устройства и подписывается VAPID (проверка без сети)', () => {
    const details = webpush.generateRequestDetails(
      subscription(),
      JSON.stringify({ title: 'Расход добавлен', body: '2 150 AMD · Food Court 7' }),
      {
        TTL: 43200,
        urgency: 'normal',
        vapidDetails: {
          subject: 'mailto:me@example.com',
          publicKey: keys.publicKey,
          privateKey: keys.privateKey,
        },
      },
    );

    expect(details.method).toBe('POST');
    expect(details.headers['Content-Encoding']).toBe('aes128gcm');
    expect(Number(details.headers.TTL)).toBe(43200);
    expect(details.headers.Urgency).toBe('normal');
    expect(details.headers.Authorization).toMatch(/^vapid t=.+, k=/);
    // Текста нет в открытом виде: служба Apple/Google прочитать его не может
    expect(Buffer.from(details.body).toString('utf8')).not.toContain('Food Court');
  });

  it('ошибка службы превращается в код ответа, нет связи в null', async () => {
    const sender = new WebPushSender({
      publicKey: keys.publicKey,
      privateKey: keys.privateKey,
      subject: 'mailto:me@example.com',
    });
    // Адрес без службы: соединиться нельзя
    const result = await sender.send(
      { ...subscription(), endpoint: 'https://push.invalid/x' },
      { id: '1', type: 'x', title: 't', body: 'b', url: '/', unread: 0, ts: 0 },
    );

    expect(result).toEqual({ ok: false, status: null });
  });
});

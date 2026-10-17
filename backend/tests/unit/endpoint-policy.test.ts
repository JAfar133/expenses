import { describe, expect, it } from 'vitest';
import { isAllowedPushEndpoint } from '../../src/modules/push/endpoint-policy.ts';

describe('адрес подписки: только известные службы', () => {
  it('принимает адреса служб Google, Apple, Mozilla и Microsoft', () => {
    for (const url of [
      'https://fcm.googleapis.com/fcm/send/abc',
      'https://fcm.googleapis.com/wp/abc',
      'https://web.push.apple.com/QWERTY',
      'https://updates.push.services.mozilla.com/wpush/v2/abc',
      'https://wns2-par02p.notify.windows.com/w/?token=abc',
    ]) {
      expect(isAllowedPushEndpoint(url)).toBe(true);
    }
  });

  it('отвергает чужие и опасные адреса: внутренние, IP, http, свой порт, логин, подмену домена', () => {
    for (const url of [
      'https://example.com/push',
      'http://fcm.googleapis.com/fcm/send/abc',
      'https://fcm.googleapis.com:8443/fcm/send/abc',
      'https://user:pass@fcm.googleapis.com/x',
      'https://127.0.0.1/x',
      'https://169.254.169.254/latest/meta-data',
      'https://[::1]/x',
      'https://localhost/x',
      'https://fcm.googleapis.com.evil.com/x',
      'https://evilfcm.googleapis.com.example.org/x',
      'https://notpush.apple.com.attacker.io/x',
      'ftp://fcm.googleapis.com/x',
      'не адрес',
      `https://fcm.googleapis.com/${'a'.repeat(1100)}`,
    ]) {
      expect(isAllowedPushEndpoint(url)).toBe(false);
    }
  });

  it('свои разрешённые хосты из настройки (точно и поддомены по «*.»)', () => {
    expect(isAllowedPushEndpoint('https://push.example.com/x', ['push.example.com'])).toBe(true);
    expect(isAllowedPushEndpoint('https://a.push.example.com/x', ['*.push.example.com'])).toBe(
      true,
    );
    expect(isAllowedPushEndpoint('https://other.example.com/x', ['push.example.com'])).toBe(false);
  });
});

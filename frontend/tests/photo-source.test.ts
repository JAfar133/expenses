import { describe, expect, it } from 'vitest';
import { isIos, needsPhotoMenu, type PhotoEnvironment } from '../src/shared/utils/photo-source.ts';

const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';
const IPADOS =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15';
const SAMSUNG =
  'Mozilla/5.0 (Linux; Android 14; SAMSUNG SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36';
const CHROME_ANDROID =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36';
const FIREFOX_ANDROID = 'Mozilla/5.0 (Android 14; Mobile; rv:125.0) Gecko/125.0 Firefox/125.0';
const DESKTOP =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const env = (patch: Partial<PhotoEnvironment>): PhotoEnvironment => ({
  userAgent: DESKTOP,
  platform: 'Win32',
  maxTouchPoints: 0,
  touch: false,
  ...patch,
});

describe('нужно ли своё меню «камера / галерея»', () => {
  it('iPhone: не нужно, система сама предлагает выбор', () => {
    expect(
      needsPhotoMenu(
        env({ userAgent: IPHONE, platform: 'iPhone', maxTouchPoints: 5, touch: true }),
      ),
    ).toBe(false);
  });

  it('iPadOS (представляется Mac, но с сенсорным экраном): не нужно', () => {
    const ipad = env({ userAgent: IPADOS, platform: 'MacIntel', maxTouchPoints: 5, touch: true });
    expect(isIos(ipad)).toBe(true);
    expect(needsPhotoMenu(ipad)).toBe(false);
  });

  it('настоящий Mac без сенсорного экрана — не iOS', () => {
    expect(isIos(env({ userAgent: IPADOS, platform: 'MacIntel', maxTouchPoints: 0 }))).toBe(false);
  });

  it('Samsung Internet: не нужно', () => {
    expect(
      needsPhotoMenu(
        env({ userAgent: SAMSUNG, platform: 'Linux armv81', maxTouchPoints: 5, touch: true }),
      ),
    ).toBe(false);
  });

  it('Chrome на Android: нужно', () => {
    expect(
      needsPhotoMenu(
        env({
          userAgent: CHROME_ANDROID,
          platform: 'Linux armv81',
          maxTouchPoints: 5,
          touch: true,
        }),
      ),
    ).toBe(true);
  });

  it('Firefox на Android: нужно', () => {
    expect(
      needsPhotoMenu(
        env({
          userAgent: FIREFOX_ANDROID,
          platform: 'Linux armv81',
          maxTouchPoints: 5,
          touch: true,
        }),
      ),
    ).toBe(true);
  });

  it('десктоп с мышью: не нужно', () => {
    expect(needsPhotoMenu(env({}))).toBe(false);
  });
});

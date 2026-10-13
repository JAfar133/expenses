import { onlineManager } from '@tanstack/react-query';
import { act, render, renderHook, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OfflineBanner } from '../src/features/offline-queue/components/OfflineBanner.tsx';
import { queueStore } from '../src/features/offline-queue/model/queue-store.ts';
import { reportNetwork } from '../src/shared/api/network-state.ts';
import { apiRequest } from '../src/shared/api/http.ts';
import { useOnlineStatus } from '../src/shared/hooks/useOnlineStatus.ts';
import { queued } from './helpers/queue-fixtures.ts';

function setOnLine(value: boolean) {
  Object.defineProperty(navigator, 'onLine', { configurable: true, value });
  act(() => {
    window.dispatchEvent(new Event(value ? 'online' : 'offline'));
  });
}

afterEach(() => {
  onlineManager.setOnline(true);
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('useOnlineStatus', () => {
  it('сеть есть по умолчанию', () => {
    expect(renderHook(() => useOnlineStatus()).result.current).toBe(true);
  });

  it('следует за событиями offline и online', () => {
    const { result } = renderHook(() => useOnlineStatus());

    setOnLine(false);
    expect(result.current).toBe(false);
    setOnLine(true);
    expect(result.current).toBe(true);
  });

  it('читает navigator.onLine при монтировании', () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });

    expect(renderHook(() => useOnlineStatus()).result.current).toBe(false);
  });

  it('запрос, не получивший ответа, считается «нет сети», даже если navigator.onLine = true', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    const { result } = renderHook(() => useOnlineStatus());

    await act(async () => {
      await apiRequest('/cards').catch(() => undefined);
    });

    expect(navigator.onLine).toBe(true);
    expect(result.current).toBe(false);
  });

  it('первый же полученный ответ (даже ошибка сервера) возвращает «сеть есть»', async () => {
    const { result } = renderHook(() => useOnlineStatus());
    act(() => reportNetwork(false));
    expect(result.current).toBe(false);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ success: false, error: { code: 'X', message: 'x' } }), {
          status: 500,
        }),
      ),
    );

    await act(async () => {
      await apiRequest('/cards').catch(() => undefined);
    });

    expect(result.current).toBe(true);
  });

  it('событие online сбрасывает прежний сбой запроса', () => {
    const { result } = renderHook(() => useOnlineStatus());
    act(() => reportNetwork(false));

    setOnLine(true);

    expect(result.current).toBe(true);
  });

  it('без navigator и window (серверный рендер) считается, что сеть есть', async () => {
    const { renderToString } = await import('react-dom/server');
    function Probe() {
      return <span>{useOnlineStatus() ? 'online' : 'offline'}</span>;
    }
    expect(renderToString(<Probe />)).toContain('online');
  });
});

describe('баннер «нет сети»', () => {
  const OFFLINE_TEXT =
    'Нет сети. Расходы сохранятся на устройстве и отправятся, когда связь появится';

  it('при сети его нет', () => {
    render(<OfflineBanner />);

    expect(screen.queryByRole('status')).toBeNull();
  });

  it('без сети показывает янтарное предупреждение с role=status', () => {
    render(<OfflineBanner />);

    setOnLine(false);

    const banner = screen.getByRole('status');
    expect(banner).toHaveTextContent(OFFLINE_TEXT);
    expect(banner).toHaveClass('bg-amber-50');
  });

  it('виден сразу, если страница открыта без сети', () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });

    render(<OfflineBanner />);

    expect(screen.getByRole('status')).toHaveTextContent(OFFLINE_TEXT);
  });

  it('пропадает, когда сеть появилась, если очередь пуста', () => {
    render(<OfflineBanner />);
    setOnLine(false);

    setOnLine(true);

    expect(screen.queryByRole('status')).toBeNull();
  });

  it('показывается и по фактическому сбою запроса при navigator.onLine = true', () => {
    render(<OfflineBanner />);

    act(() => reportNetwork(false));

    expect(screen.getByRole('status')).toHaveTextContent(OFFLINE_TEXT);
  });

  it('если в очереди есть расходы, при возвращении сети на пару секунд: «Связь восстановлена. Отправляю расходы…»', async () => {
    await queueStore.add(queued('1'));
    render(<OfflineBanner />);
    await vi.waitFor(() => expect(queueStore.list()).resolves.toHaveLength(1));
    setOnLine(false);
    await screen.findByText(OFFLINE_TEXT);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

    setOnLine(true);

    expect(screen.getByRole('status')).toHaveTextContent('Связь восстановлена. Отправляю расходы…');
    act(() => {
      vi.advanceTimersByTime(3100);
    });
    expect(screen.queryByRole('status')).toBeNull();
  });
});

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LinkPanel } from '../src/features/group/components/LinkPanel.tsx';

const setClipboard = (value: unknown) =>
  Object.defineProperty(navigator, 'clipboard', { value, configurable: true });
const setExecCommand = (result: boolean) =>
  Object.defineProperty(document, 'execCommand', {
    value: vi.fn(() => result),
    configurable: true,
  });

const renderPanel = () =>
  render(<LinkPanel title="Ссылка для Оли" token="tok123" expiresAt="2026-10-19T12:00:00Z" />);
const copyButton = () => screen.getByRole('button', { name: /Скопир/ });

afterEach(() => {
  setClipboard(undefined);
});

describe('копирование ссылки', () => {
  it('копирует полную ссылку через буфер обмена и пишет «Скопировано»', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setClipboard({ writeText });
    renderPanel();

    fireEvent.click(copyButton());

    await waitFor(() => expect(copyButton()).toHaveAccessibleName('Скопировано'));
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/invite/tok123`);
  });

  it('без navigator.clipboard (не https) выделяет текст и копирует старым способом', async () => {
    setClipboard(undefined);
    setExecCommand(true);
    renderPanel();

    fireEvent.click(copyButton());

    await waitFor(() => expect(copyButton()).toHaveAccessibleName('Скопировано'));
    expect(document.execCommand).toHaveBeenCalledWith('copy');
  });

  it('если буфер отказал, пробует старый способ', async () => {
    setClipboard({ writeText: vi.fn().mockRejectedValue(new Error('denied')) });
    setExecCommand(true);
    renderPanel();

    fireEvent.click(copyButton());

    await waitFor(() => expect(copyButton()).toHaveAccessibleName('Скопировано'));
  });

  it('если не вышло совсем, объясняет, как скопировать вручную', async () => {
    setClipboard(undefined);
    setExecCommand(false);
    renderPanel();

    fireEvent.click(copyButton());

    expect(await screen.findByRole('status')).toHaveTextContent('Не удалось скопировать');
    expect(copyButton()).toHaveAccessibleName('Скопировать');
  });

  it('надпись «Скопировано» возвращается к «Скопировать»', async () => {
    vi.useFakeTimers();
    setClipboard({ writeText: vi.fn().mockResolvedValue(undefined) });
    renderPanel();

    await act(async () => {
      fireEvent.click(copyButton());
    });
    expect(copyButton()).toHaveAccessibleName('Скопировано');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2600);
    });

    expect(copyButton()).toHaveAccessibleName('Скопировать');
    vi.useRealTimers();
  });
});

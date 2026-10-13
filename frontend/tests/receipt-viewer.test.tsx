import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ReceiptViewer } from '../src/features/receipts/components/ReceiptViewer.tsx';
import {
  FIT,
  MAX_SCALE,
  clampView,
  toggleZoom,
  zoomIn,
  zoomOut,
} from '../src/features/receipts/model/zoom.ts';
import { useScrollLock } from '../src/shared/hooks/useScrollLock.ts';
import { AnchoredPanel } from '../src/shared/ui/AnchoredPanel.tsx';
import { Modal } from '../src/shared/ui/Modal.tsx';

function Host() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Камера
      </button>
      {open && <ReceiptViewer expenseId="e1" onClose={() => setOpen(false)} />}
    </>
  );
}

const photo = () => screen.getByRole('img', { name: 'Фото чека' });

describe('просмотрщик фото чека', () => {
  it('открывается вписанным (масштаб 1), без «По размеру» и «Уменьшить»', async () => {
    const user = userEvent.setup();
    render(<Host />);
    await user.click(screen.getByRole('button', { name: 'Камера' }));

    expect(photo()).toHaveAttribute('data-scale', '1.00');
    expect(photo()).toHaveClass('max-h-full', 'max-w-full', 'object-contain');
    expect(screen.getByRole('button', { name: 'По размеру' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Уменьшить' })).toBeDisabled();
  });

  it('«+» и «−» меняют масштаб, «По размеру» сбрасывает; у кнопок есть title', async () => {
    const user = userEvent.setup();
    render(<Host />);
    await user.click(screen.getByRole('button', { name: 'Камера' }));

    await user.click(screen.getByRole('button', { name: 'Увеличить' }));
    expect(photo()).toHaveAttribute('data-scale', '1.50');
    await user.click(screen.getByRole('button', { name: 'Увеличить' }));
    expect(photo()).toHaveAttribute('data-scale', '2.25');
    await user.click(screen.getByRole('button', { name: 'Уменьшить' }));
    expect(photo()).toHaveAttribute('data-scale', '1.50');
    await user.click(screen.getByRole('button', { name: 'Увеличить' }));
    await user.click(screen.getByRole('button', { name: 'По размеру' }));

    expect(photo()).toHaveAttribute('data-scale', '1.00');
    for (const name of ['Увеличить', 'Уменьшить', 'По размеру', 'Закрыть']) {
      expect(screen.getByRole('button', { name })).toHaveAttribute('title', name);
    }
  });

  it('двойной клик увеличивает и возвращает', async () => {
    const user = userEvent.setup();
    render(<Host />);
    await user.click(screen.getByRole('button', { name: 'Камера' }));

    await user.dblClick(photo());
    expect(photo()).toHaveAttribute('data-scale', '2.50');
    await user.dblClick(photo());
    expect(photo()).toHaveAttribute('data-scale', '1.00');
  });

  it('Ctrl + колесо увеличивает', async () => {
    const user = userEvent.setup();
    render(<Host />);
    await user.click(screen.getByRole('button', { name: 'Камера' }));

    photo().parentElement!.dispatchEvent(
      new WheelEvent('wheel', { deltaY: -100, ctrlKey: true, bubbles: true, cancelable: true }),
    );

    await vi.waitFor(() => expect(photo().getAttribute('data-scale')).not.toBe('1.00'));
  });

  it('крестик и Escape закрывают, фокус возвращается на значок камеры', async () => {
    const user = userEvent.setup();
    render(<Host />);
    const camera = screen.getByRole('button', { name: 'Камера' });

    await user.click(camera);
    expect(screen.getByRole('button', { name: 'Закрыть' })).toHaveFocus();
    await user.click(screen.getByRole('button', { name: 'Закрыть' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(camera).toHaveFocus();

    await user.click(camera);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(camera).toHaveFocus();
  });

  it('пока окно открыто, прокрутка страницы заблокирована; после закрытия снимается', async () => {
    const user = userEvent.setup();
    render(<Host />);
    await user.click(screen.getByRole('button', { name: 'Камера' }));
    expect(document.body.style.position).toBe('fixed');
    expect(document.body.style.overflow).toBe('hidden');

    await user.click(screen.getByRole('button', { name: 'Закрыть' }));

    expect(document.body.style.position).toBe('');
    expect(document.body.style.overflow).toBe('');
  });
});

describe('блокировка прокрутки', () => {
  function Nested() {
    const [outer, setOuter] = useState(true);
    const [inner, setInner] = useState(true);
    return (
      <>
        {outer && (
          <Modal title="Первое" onClose={() => setOuter(false)}>
            <button type="button" onClick={() => setOuter(false)}>
              Закрыть первое
            </button>
          </Modal>
        )}
        {inner && (
          <Modal title="Второе" onClose={() => setInner(false)}>
            <button type="button" onClick={() => setInner(false)}>
              Закрыть второе
            </button>
          </Modal>
        )}
      </>
    );
  }

  it('вложенные окна: страница разблокируется только после закрытия последнего', async () => {
    const user = userEvent.setup();
    render(<Nested />);
    expect(document.body.style.overflow).toBe('hidden');

    await user.click(screen.getByRole('button', { name: 'Закрыть первое' }));
    expect(document.body.style.overflow).toBe('hidden');
    await user.click(screen.getByRole('button', { name: 'Закрыть второе' }));

    expect(document.body.style.overflow).toBe('');
    expect(document.body.style.position).toBe('');
  });

  it('хук с active=false ничего не блокирует', () => {
    function Probe() {
      useScrollLock(false);
      return null;
    }
    render(<Probe />);
    expect(document.body.style.overflow).toBe('');
  });
});

describe('масштаб', () => {
  it('границы масштаба и сдвига: на 1 фото вписано без сдвига, дальше не вытащить за край', () => {
    expect(clampView({ scale: 1, x: 40, y: 10 }, 300, 200)).toEqual(FIT);
    expect(clampView({ scale: 9, x: 0, y: 0 }, 300, 200).scale).toBe(MAX_SCALE);
    expect(clampView({ scale: 2, x: 999, y: -999 }, 300, 200)).toEqual({
      scale: 2,
      x: 150,
      y: -100,
    });
  });

  it('шаги и двойное касание', () => {
    expect(zoomOut(FIT, 300, 200)).toEqual(FIT);
    expect(zoomIn(FIT, 300, 200).scale).toBe(1.5);
    expect(toggleZoom(FIT).scale).toBe(2.5);
    expect(toggleZoom({ scale: 2.5, x: 5, y: 5 })).toEqual(FIT);
  });
});

describe('шапка окон не прокручивается', () => {
  it('Modal: заголовок вне прокручиваемого тела', () => {
    render(
      <Modal title="Окно" onClose={() => undefined}>
        <p>Содержимое</p>
      </Modal>,
    );
    const heading = screen.getByRole('heading', { name: 'Окно' });
    const body = screen.getByText('Содержимое').parentElement!;

    expect(body).toHaveClass('overflow-y-auto', 'flex-1', 'min-h-0');
    expect(body.contains(heading)).toBe(false);
    expect(heading).toHaveClass('shrink-0', 'bg-white');
    expect(screen.getByRole('dialog')).toHaveClass('flex', 'flex-col', 'overflow-hidden');
  });

  it('AnchoredPanel: шапка с крестиком вне прокручиваемого тела', async () => {
    render(
      <AnchoredPanel
        label="Панель"
        open
        onOpenChange={() => undefined}
        trigger={(props) => <button {...props}>Открыть</button>}
      >
        <p>Содержимое</p>
      </AnchoredPanel>,
    );
    const close = screen.getByRole('button', { name: 'Закрыть' });
    const body = screen.getByText('Содержимое').parentElement!;

    expect(body).toHaveClass('overflow-y-auto', 'flex-1', 'min-h-0');
    expect(body.contains(close)).toBe(false);
    expect(close.parentElement).toHaveClass('shrink-0');
  });
});

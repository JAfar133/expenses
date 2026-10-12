import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { HelpHint } from '../src/shared/ui/HelpHint.tsx';

function setup() {
  render(
    <div>
      <p>Снаружи</p>
      <HelpHint>Текст подсказки</HelpHint>
    </div>,
  );
  return { person: userEvent.setup(), button: screen.getByRole('button', { name: 'Подсказка' }) };
}

describe('HelpHint', () => {
  it('открывается и закрывается нажатием, меняя aria-expanded', async () => {
    const { person, button } = setup();
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Текст подсказки')).toBeNull();

    await person.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Текст подсказки')).toBeInTheDocument();

    await person.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Текст подсказки')).toBeNull();
  });

  it('закрывается по Escape', async () => {
    const { person, button } = setup();
    await person.click(button);

    await person.keyboard('{Escape}');

    expect(screen.queryByText('Текст подсказки')).toBeNull();
  });

  it('закрывается по нажатию вне подсказки', async () => {
    const { person, button } = setup();
    await person.click(button);

    await person.click(screen.getByText('Снаружи'));

    expect(screen.queryByText('Текст подсказки')).toBeNull();
  });

  it('работает с клавиатуры', async () => {
    const { person } = setup();
    await person.tab();
    await person.keyboard('{Enter}');

    expect(screen.getByText('Текст подсказки')).toBeInTheDocument();
  });

  it('мышь: открывается при наведении и закрывается, когда курсор уходит', async () => {
    const user = userEvent.setup();
    render(<HelpHint>Текст подсказки</HelpHint>);
    const button = screen.getByRole('button', { name: 'Подсказка' });

    await user.hover(button);
    expect(screen.getByRole('note')).toHaveTextContent('Текст подсказки');
    await user.unhover(button);

    expect(screen.queryByRole('note')).toBeNull();
  });

  it('нажатие закрепляет подсказку: курсор уходит, а она остаётся', async () => {
    const user = userEvent.setup();
    render(<HelpHint>Текст подсказки</HelpHint>);
    const button = screen.getByRole('button', { name: 'Подсказка' });

    await user.click(button);
    await user.unhover(button);

    expect(screen.getByRole('note')).toBeInTheDocument();
  });
});

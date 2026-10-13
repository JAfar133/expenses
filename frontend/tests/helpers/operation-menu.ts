import { screen, within } from '@testing-library/react';
import type { UserEvent } from '@testing-library/user-event';

/** Opens the «⋯» menu of a row (the container is the row, or a table with a single row) and picks an item. */
export async function chooseAction(user: UserEvent, container: HTMLElement, action: string) {
  await user.click(within(container).getByRole('button', { name: 'Действия' }));
  await user.click(await screen.findByRole('menuitem', { name: action }));
}

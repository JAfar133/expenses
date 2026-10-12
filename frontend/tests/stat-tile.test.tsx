import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StatTile } from '../src/features/analytics/components/StatTile.tsx';

describe('плитка показателя', () => {
  it('длинная сумма получает меньший шрифт и не выходит за плитку', () => {
    render(<StatTile label="Потрачено" value="103 404,89 RUB" />);

    const value = screen.getByText('103 404,89 RUB');
    expect(value.className).toContain('text-base');
    expect(value.parentElement?.className).toContain('overflow-hidden');
  });

  it('короткая сумма остаётся крупной', () => {
    render(<StatTile label="Операций" value="41" />);

    expect(screen.getByText('41').className).toContain('text-xl');
  });
});

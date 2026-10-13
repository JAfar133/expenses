import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ParseNotices } from '../src/features/ai/components/ParseNotices.tsx';
import { ParsingBadge } from '../src/features/ai/components/ParsingBadge.tsx';
import {
  beginParse,
  dismissParseResult,
  endParse,
  resetParseState,
} from '../src/features/ai/model/parse-state.ts';

afterEach(() => resetParseState());

describe('состояние разбора чека', () => {
  it('индикатор в строке виден только у той записи, чей чек разбирается', () => {
    render(
      <>
        <ParsingBadge expenseId="a" />
        <ParsingBadge expenseId="b" />
      </>,
    );
    expect(screen.queryByText('ИИ обрабатывает чек…')).toBeNull();

    act(() => beginParse('a'));
    expect(screen.getAllByText('ИИ обрабатывает чек…')).toHaveLength(1);

    act(() => endParse('a', { kind: 'ok', message: 'готово' }));
    expect(screen.queryByText('ИИ обрабатывает чек…')).toBeNull();
  });

  it('на странице «Добавить»: индикатор, затем результат, который можно убрать', () => {
    render(<ParseNotices />);

    act(() => beginParse('a'));
    expect(screen.getByRole('status')).toHaveTextContent('ИИ обрабатывает чек…');
    act(() =>
      endParse('a', { kind: 'error', message: 'Не удалось разобрать чек, заполните вручную' }),
    );
    expect(screen.getByText('Не удалось разобрать чек, заполните вручную')).toBeInTheDocument();
    act(() => dismissParseResult());

    expect(screen.queryByRole('status')).toBeNull();
  });

  it('два чека сразу: индикатор остаётся, пока разбирается хотя бы один', () => {
    render(<ParseNotices />);

    act(() => {
      beginParse('a');
      beginParse('b');
      endParse('a', { kind: 'ok', message: 'ok' });
    });

    expect(screen.getByText('ИИ обрабатывает чек…')).toBeInTheDocument();
  });
});

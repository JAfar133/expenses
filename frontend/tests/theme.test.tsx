import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, waitFor } from '@testing-library/react';
// @ts-expect-error node types are not installed: the files are read as text
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useTheme } from '../src/features/preferences/hooks/useTheme.ts';
import { sanitizePreferences } from '../src/features/preferences/model/preferences.ts';
import { applyTheme } from '../src/shared/utils/theme.ts';

const root = () => document.documentElement;

afterEach(() => {
  root().removeAttribute('data-theme');
  vi.unstubAllGlobals();
});

function Probe() {
  useTheme();
  return null;
}

function renderProbe(serverTheme?: string) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      serverTheme === undefined
        ? new Response(JSON.stringify({ success: false, error: { code: 'X', message: 'x' } }), {
            status: 500,
          })
        : new Response(JSON.stringify({ success: true, data: { theme: serverTheme } }), {
            status: 200,
          }),
    ),
  );
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <Probe />
    </QueryClientProvider>,
  );
}

describe('тема', () => {
  it('applyTheme: явный выбор ставит data-theme, «system» убирает атрибут', () => {
    applyTheme('dark');
    expect(root().getAttribute('data-theme')).toBe('dark');
    applyTheme('light');
    expect(root().getAttribute('data-theme')).toBe('light');
    applyTheme('system');
    expect(root().hasAttribute('data-theme')).toBe(false);
    applyTheme(undefined);
    expect(root().hasAttribute('data-theme')).toBe(false);
  });

  it('ключ theme допускает только system, light, dark', () => {
    expect(sanitizePreferences({ theme: 'dark' })).toEqual({ theme: 'dark' });
    expect(sanitizePreferences({ theme: 'sepia' })).toEqual({});
  });

  it('без ответа сервера тема берётся из localStorage (то же значение читает скрипт в index.html)', async () => {
    localStorage.setItem('analytics.theme', 'dark');

    renderProbe();

    await waitFor(() => expect(root().getAttribute('data-theme')).toBe('dark'));
  });

  it('значение с сервера применяется к странице', async () => {
    renderProbe('light');

    await waitFor(() => expect(root().getAttribute('data-theme')).toBe('light'));
  });

  it('по умолчанию («Как в системе») атрибута нет', async () => {
    renderProbe('system');

    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(root().hasAttribute('data-theme')).toBe(false);
  });
});

describe('CSS и страница', () => {
  const css: string = readFileSync('src/index.css', 'utf8');
  const html: string = readFileSync('index.html', 'utf8');

  it('вариант dark: явный атрибут, а prefers-color-scheme только когда атрибута нет', () => {
    expect(css).toContain('@custom-variant dark');
    expect(css).toContain("[data-theme='dark']");
    expect(css).toMatch(/prefers-color-scheme: dark\) \{\s*&:where\(:root:not\(\[data-theme\]\)/);
  });

  it('цвета графиков и календаря следуют выбору, а не только системе', () => {
    expect(css).toContain(':root:not([data-theme]) {');
    expect(css).toContain(":root[data-theme='dark'] {");
    expect(css).toContain(":root[data-theme='dark'] .rdp-root");
    expect(css).toContain(":root[data-theme='light'] {\n  color-scheme: light;");
  });

  it('скрипт в <head> ставит тему до первого рендера из localStorage', () => {
    expect(html).toContain("localStorage.getItem('analytics.theme')");
    expect(html.indexOf('data-theme')).toBeLessThan(html.indexOf('<div id="root">'));
    expect(html.indexOf('<script>')).toBeLessThan(html.indexOf('src="/src/main.tsx"'));
  });
});

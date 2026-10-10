import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Тесты с PostgreSQL поднимают PGlite (WASM): на занятой машине это занимает секунды
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});

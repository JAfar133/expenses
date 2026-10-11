import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// Переменные окружения Node (типы @types/node в проекте не подключены)
declare const process: { env: Record<string, string | undefined> };

// Адрес backend для режима разработки; по умолчанию локальный (можно подменить, например, чтобы проверить на отдельном стенде)
const apiTarget = process.env.API_TARGET ?? 'http://127.0.0.1:3000';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // В разработке запросы к API идут на локальный backend
    proxy: {
      '/api': {
        target: apiTarget,
        // Не подменять Host: backend сверяет с ним заголовок Origin (защита от CSRF), а браузер шлёт адрес Vite.
        // Короткая запись прокси ('/api': 'http://…') включает changeOrigin и ломает вход.
        changeOrigin: false,
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    css: false,
  },
});

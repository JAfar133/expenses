import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// Node environment variables (@types/node is not included in the project)
declare const process: { env: Record<string, string | undefined> };

// Backend address for dev mode; local by default (can be overridden, e.g. to test against a separate environment)
const apiTarget = process.env.API_TARGET ?? 'http://127.0.0.1:3000';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // In development, API requests go to the local backend
    proxy: {
      '/api': {
        target: apiTarget,
        // Do not override Host: the backend checks the Origin header against it (CSRF protection), and the browser sends the Vite address.
        // The short proxy form ('/api': 'http://...') enables changeOrigin and breaks sign-in.
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

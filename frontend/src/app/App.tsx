import { lazy } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { AuthGate } from '../features/auth/components/AuthGate.tsx';
import { AddExpensePage } from '../pages/AddExpensePage.tsx';
import { AppShell } from './AppShell.tsx';
import { QueryProvider } from './providers/QueryProvider.tsx';

// Страница анализа и графики грузятся только при открытии: форма добавления расхода остаётся лёгкой
const AnalyticsRoutes = lazy(() => import('../features/analytics/pages/AnalyticsRoutes.tsx'));

export function App() {
  return (
    <QueryProvider>
      <BrowserRouter>
        <AuthGate>
          {(user) => (
            <Routes>
              <Route element={<AppShell user={user} />}>
                <Route index element={<AddExpensePage user={user} />} />
                <Route path="analytics/*" element={<AnalyticsRoutes />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Route>
            </Routes>
          )}
        </AuthGate>
      </BrowserRouter>
    </QueryProvider>
  );
}

import { Suspense, lazy } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { AuthGate } from '../features/auth/components/AuthGate.tsx';
import { AddExpensePage } from '../pages/AddExpensePage.tsx';
import { AppShell } from './AppShell.tsx';
import { QueryProvider } from './providers/QueryProvider.tsx';

// The analytics page and charts load only when opened: the expense form stays lightweight
const SettingsPage = lazy(() => import('../features/settings/pages/SettingsPage.tsx'));
const AnalyticsRoutes = lazy(() => import('../features/analytics/pages/AnalyticsRoutes.tsx'));
const GroupPage = lazy(() => import('../features/group/pages/GroupPage.tsx'));
const AdminPage = lazy(() => import('../features/admin/pages/AdminPage.tsx'));
const InvitePage = lazy(() => import('../features/group/pages/InvitePage.tsx'));

export function App() {
  return (
    <QueryProvider>
      <BrowserRouter>
        <Routes>
          {/* Public: opened from an invitation link, no sign-in needed */}
          <Route path="invite/:token" element={<InviteRoute />} />
          <Route path="*" element={<SignedInApp />} />
        </Routes>
      </BrowserRouter>
    </QueryProvider>
  );
}

function SignedInApp() {
  return (
    <AuthGate>
      {(user) => (
        <Routes>
          <Route element={<AppShell user={user} />}>
            <Route index element={<AddExpensePage user={user} />} />
            <Route path="analytics/*" element={<AnalyticsRoutes />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="group" element={<GroupPage />} />
            <Route path="admin" element={<AdminPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      )}
    </AuthGate>
  );
}

function InviteRoute() {
  return (
    <Suspense fallback={null}>
      <InvitePage />
    </Suspense>
  );
}

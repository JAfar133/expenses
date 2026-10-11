import { Navigate, Route, Routes } from 'react-router';
import AnalyticsLayout from './AnalyticsLayout.tsx';
import ComparePage from './ComparePage.tsx';
import OperationsPage from './OperationsPage.tsx';
import OverviewPage from './OverviewPage.tsx';

/** Маршруты раздела «Анализ»; грузятся одним фрагментом. */
export default function AnalyticsRoutes() {
  return (
    <Routes>
      <Route element={<AnalyticsLayout />}>
        <Route index element={<OverviewPage />} />
        <Route path="operations" element={<OperationsPage />} />
        <Route path="compare" element={<ComparePage />} />
        <Route path="*" element={<Navigate to="/analytics" replace />} />
      </Route>
    </Routes>
  );
}

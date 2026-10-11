import { AuthGate } from '../features/auth/components/AuthGate.tsx';
import { AddExpensePage } from '../pages/AddExpensePage.tsx';
import { QueryProvider } from './providers/QueryProvider.tsx';

export function App() {
  return (
    <QueryProvider>
      <AuthGate>{(user) => <AddExpensePage user={user} />}</AuthGate>
    </QueryProvider>
  );
}

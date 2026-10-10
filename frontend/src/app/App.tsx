import { AddExpensePage } from '../pages/AddExpensePage.tsx';
import { QueryProvider } from './providers/QueryProvider.tsx';

export function App() {
  return (
    <QueryProvider>
      <AddExpensePage />
    </QueryProvider>
  );
}

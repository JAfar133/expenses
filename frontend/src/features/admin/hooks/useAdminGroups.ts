import { useQuery } from '@tanstack/react-query';
import { fetchAdminGroups } from '../api/admin.api.ts';

export const ADMIN_GROUPS_KEY = ['admin', 'groups'];

export function useAdminGroups() {
  return useQuery({ queryKey: ADMIN_GROUPS_KEY, queryFn: fetchAdminGroups, retry: false });
}

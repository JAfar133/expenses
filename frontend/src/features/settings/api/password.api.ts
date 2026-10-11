import { apiRequest } from '../../../shared/api/http.ts';

/** Password change. The user's other sessions are closed on the server, the current one stays. */
export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  await apiRequest<unknown>('/auth/password', {
    method: 'POST',
    body: JSON.stringify({ currentPassword, newPassword }),
  });
}

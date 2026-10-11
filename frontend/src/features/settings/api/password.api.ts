import { apiRequest } from '../../../shared/api/http.ts';

/** Смена пароля. Остальные входы пользователя на сервере закрываются, текущий остаётся. */
export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  await apiRequest<unknown>('/auth/password', {
    method: 'POST',
    body: JSON.stringify({ currentPassword, newPassword }),
  });
}

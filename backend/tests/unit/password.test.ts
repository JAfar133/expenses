import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '../../src/modules/auth/password.ts';
import { generateToken, hashToken } from '../../src/modules/auth/tokens.ts';

describe('hashPassword / verifyPassword', () => {
  it('верный пароль подходит, неверный нет', async () => {
    const hash = await hashPassword('correct horse battery');

    expect(await verifyPassword('correct horse battery', hash)).toBe(true);
    expect(await verifyPassword('correct horse batterz', hash)).toBe(false);
    expect(await verifyPassword('', hash)).toBe(false);
  });

  it('хеш не содержит пароль и имеет формат scrypt$N$r$p$соль$хеш', async () => {
    const hash = await hashPassword('secret-password-123');

    expect(hash).not.toContain('secret-password-123');
    expect(hash).toMatch(/^scrypt\$32768\$8\$1\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
  });

  it('один и тот же пароль даёт разные хеши (у каждого своя соль)', async () => {
    const [a, b] = [await hashPassword('same-password-12'), await hashPassword('same-password-12')];

    expect(a).not.toBe(b);
    expect(await verifyPassword('same-password-12', a)).toBe(true);
    expect(await verifyPassword('same-password-12', b)).toBe(true);
  });

  it('поддерживает кириллицу и длинные пароли', async () => {
    const password = 'пароль-с-кириллицей-и-эмодзи-🙂'.repeat(10);
    const hash = await hashPassword(password);

    expect(await verifyPassword(password, hash)).toBe(true);
    expect(await verifyPassword(password.slice(0, -1), hash)).toBe(false);
  });

  it.each([
    ['пустая строка', ''],
    ['чужая схема', 'bcrypt$12$abc$def'],
    ['обрезанный хеш', 'scrypt$32768$8$1$c2FsdA=='],
    ['мусор вместо параметров', 'scrypt$abc$def$ghi$c2FsdA==$aGFzaA=='],
  ])('повреждённый хеш (%s) не подходит и не бросает ошибку', async (_name, stored) => {
    await expect(verifyPassword('any-password-123', stored)).resolves.toBe(false);
  });
});

describe('токены', () => {
  it('токены случайные, длинные и пригодны для куки', () => {
    const tokens = new Set(Array.from({ length: 50 }, generateToken));

    expect(tokens.size).toBe(50);
    expect([...tokens][0]).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('хеш токена стабилен и не равен самому токену', () => {
    const token = generateToken();

    expect(hashToken(token)).toBe(hashToken(token));
    expect(hashToken(token)).not.toBe(token);
    expect(hashToken(token)).toMatch(/^[0-9a-f]{64}$/);
  });
});

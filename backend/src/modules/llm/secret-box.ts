import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { AppError } from '../../errors/app-error.ts';

const VERSION = 'v1';

/**
 * Encrypts secrets kept in the database (AES-256-GCM). The master key comes from the environment (`SECRETS_KEY`),
 * so a copy of the database alone does not reveal the secrets.
 */
export class SecretBox {
  private readonly key: Buffer | undefined;

  constructor(secret: string | undefined) {
    this.key = secret ? createHash('sha256').update(secret).digest() : undefined;
  }

  /** Whether a master key is configured: without it nothing can be stored. */
  get available(): boolean {
    return this.key !== undefined;
  }

  encrypt(plain: string): string {
    const key = this.requireKey();
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return [VERSION, iv, cipher.getAuthTag(), data].map((part) => toText(part)).join(':');
  }

  /** The original text, or undefined when the value cannot be decrypted (another master key, damaged data). */
  decrypt(stored: string): string | undefined {
    if (!this.key) return undefined;
    const [version, iv, tag, data] = stored.split(':');
    if (version !== VERSION || !iv || !tag || !data) return undefined;
    try {
      const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64'));
      decipher.setAuthTag(Buffer.from(tag, 'base64'));
      return Buffer.concat([
        decipher.update(Buffer.from(data, 'base64')),
        decipher.final(),
      ]).toString('utf8');
    } catch {
      return undefined;
    }
  }

  private requireKey(): Buffer {
    if (!this.key) {
      throw new AppError(
        409,
        'SECRETS_KEY_MISSING',
        'На сервере не задан SECRETS_KEY: ключ нельзя сохранить из приложения',
      );
    }
    return this.key;
  }
}

const toText = (part: string | Buffer) =>
  typeof part === 'string' ? part : part.toString('base64');

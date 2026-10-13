import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

/** Receipt files on the disk. Paths are built only from ids by the service, and still never leave the folder. */
export class ReceiptStore {
  constructor(private readonly dir: string) {}

  private resolve(relativePath: string): string {
    const full = path.resolve(this.dir, relativePath);
    if (!full.startsWith(path.resolve(this.dir) + path.sep)) throw new Error('Bad receipt path');
    return full;
  }

  async save(relativePath: string, bytes: Buffer): Promise<void> {
    const full = this.resolve(relativePath);
    await mkdir(path.dirname(full), { recursive: true });
    // `wx`: a file is never overwritten, a replaced photo is a new file
    await writeFile(full, bytes, { flag: 'wx' });
  }

  read(relativePath: string): Promise<Buffer> {
    return readFile(this.resolve(relativePath));
  }
}

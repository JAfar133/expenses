import { copyFile, mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { OneDriveError } from '../../src/services/onedrive/errors.ts';
import type { DownloadedFile, OneDriveService } from '../../src/services/onedrive/types.ts';
import { readCategories } from '../../src/services/excel.service.ts';
import { ExcelExpenseRepository } from '../../src/storage/excel/excel.repository.ts';

const FIXTURE = new URL('../fixtures/expenses-dev.xlsx', import.meta.url).pathname;
const options = { sheetName: 'Лист1', tableName: 'Операции' };
const expense = {
  date: '2026-10-10',
  card: 'Миша',
  category: 'продукты',
  name: 'Тестовая покупка',
  amount: 1500,
};

/** Подменяет OneDrive: «скачивает» фикстуру и запоминает, что было загружено. */
class FakeOneDrive implements OneDriveService {
  uploaded: Buffer[] = [];
  downloadedPaths: string[] = [];
  uploadError?: Error;
  downloadError?: Error;

  async getFileMetadata() {
    return { size: 1, modifiedAt: '', hash: '', version: 'v1' };
  }

  async downloadFile(): Promise<DownloadedFile> {
    if (this.downloadError) throw this.downloadError;
    const directory = await mkdtemp(join(tmpdir(), 'fake-onedrive-'));
    const localPath = join(directory, 'source.xlsx');
    await copyFile(FIXTURE, localPath);
    this.downloadedPaths.push(localPath);
    return { localPath, size: (await stat(localPath)).size, version: 'v1' };
  }

  async uploadFile(localPath: string) {
    if (this.uploadError) throw this.uploadError;
    this.uploaded.push(await readFile(localPath));
    return { version: 'v2' };
  }
}

const createRepository = (oneDrive: FakeOneDrive) => new ExcelExpenseRepository(oneDrive, options);

describe('create', () => {
  it('загружает обновлённый файл с новой операцией', async () => {
    const oneDrive = new FakeOneDrive();

    await createRepository(oneDrive).create(expense);

    expect(oneDrive.uploaded).toHaveLength(1);
    expect(await readCategories(oneDrive.uploaded[0]!, options)).toContain('продукты');
  });

  it('последовательно обрабатывает параллельные запросы без потери записей', async () => {
    const oneDrive = new FakeOneDrive();
    const repository = createRepository(oneDrive);

    await Promise.all([repository.create(expense), repository.create({ ...expense, amount: 2 })]);

    expect(oneDrive.uploaded).toHaveLength(2);
  });

  it('удаляет временные файлы после работы', async () => {
    const oneDrive = new FakeOneDrive();

    await createRepository(oneDrive).create(expense);

    await expect(stat(dirname(oneDrive.downloadedPaths[0]!))).rejects.toThrow();
  });

  it('конфликт версии → 409 и без загрузки', async () => {
    const oneDrive = new FakeOneDrive();
    oneDrive.uploadError = new OneDriveError('VERSION_CONFLICT', 'changed');

    await expect(createRepository(oneDrive).create(expense)).rejects.toMatchObject({
      statusCode: 409,
    });
  });

  it('сетевая ошибка при загрузке → WRITE_STATUS_UNKNOWN', async () => {
    const oneDrive = new FakeOneDrive();
    oneDrive.uploadError = new OneDriveError('NETWORK', 'reset');

    await expect(createRepository(oneDrive).create(expense)).rejects.toMatchObject({
      code: 'WRITE_STATUS_UNKNOWN',
    });
  });

  it('файл заблокирован в Excel → 423, запись не выполнялась', async () => {
    const oneDrive = new FakeOneDrive();
    oneDrive.uploadError = new OneDriveError('FILE_LOCKED', '423 Locked');

    await expect(createRepository(oneDrive).create(expense)).rejects.toMatchObject({
      statusCode: 423,
      code: 'FILE_LOCKED',
    });
  });

  it('ошибка доступа при загрузке → 503', async () => {
    const oneDrive = new FakeOneDrive();
    oneDrive.uploadError = new OneDriveError('ACCESS_DENIED', 'forbidden');

    await expect(createRepository(oneDrive).create(expense)).rejects.toMatchObject({
      statusCode: 503,
    });
  });

  it('недоступность при скачивании → 503 и без загрузки', async () => {
    const oneDrive = new FakeOneDrive();
    oneDrive.downloadError = new OneDriveError('NETWORK', 'offline');

    await expect(createRepository(oneDrive).create(expense)).rejects.toMatchObject({
      statusCode: 503,
    });
    expect(oneDrive.uploaded).toHaveLength(0);
  });

  it('некорректные данные не доходят до загрузки', async () => {
    const oneDrive = new FakeOneDrive();

    await expect(createRepository(oneDrive).create({ ...expense, amount: 0 })).rejects.toThrow();
    expect(oneDrive.uploaded).toHaveLength(0);
  });
});

describe('listCategories', () => {
  it('возвращает уникальные категории из таблицы', async () => {
    const categories = await createRepository(new FakeOneDrive()).listCategories();

    expect(categories.length).toBeGreaterThan(0);
    expect(new Set(categories).size).toBe(categories.length);
  });
});

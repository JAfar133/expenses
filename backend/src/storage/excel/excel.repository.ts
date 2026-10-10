import { readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Mutex } from '../../infrastructure/locking/mutex.ts';
import { appendExpenseToBuffer, readCategories } from '../../services/excel.service.ts';
import type { ExcelOptions } from '../../services/excel/types.ts';
import type { DownloadedFile, OneDriveService } from '../../services/onedrive/types.ts';
import type { Expense, ExpenseRepository } from '../expense.repository.ts';
import { mapReadError, mapWriteError } from './map-onedrive-error.ts';

export class ExcelExpenseRepository implements ExpenseRepository {
  /** Только одна запись в файл одновременно */
  private readonly writeLock = new Mutex();

  constructor(
    private readonly oneDrive: OneDriveService,
    private readonly excelOptions: ExcelOptions,
  ) {}

  create(expense: Expense): Promise<Expense> {
    return this.writeLock.run(() => this.appendAndUpload(expense));
  }

  async listCategories(): Promise<string[]> {
    return this.withDownloadedFile(async (file) =>
      readCategories(await readFile(file.localPath), this.excelOptions),
    );
  }

  private appendAndUpload(expense: Expense): Promise<Expense> {
    return this.withDownloadedFile(async (file) => {
      const source = await readFile(file.localPath);
      const { output } = await appendExpenseToBuffer(source, expense, this.excelOptions);

      const resultPath = join(dirname(file.localPath), 'result.xlsx');
      await writeFile(resultPath, output);

      try {
        await this.oneDrive.uploadFile(resultPath, file.version);
      } catch (error) {
        throw mapWriteError(error);
      }
      return expense;
    });
  }

  /** Скачивает свежую копию во временный каталог и гарантированно удаляет её после работы. */
  private async withDownloadedFile<T>(work: (file: DownloadedFile) => Promise<T>): Promise<T> {
    let file: DownloadedFile;
    try {
      file = await this.oneDrive.downloadFile();
    } catch (error) {
      throw mapReadError(error);
    }

    try {
      return await work(file);
    } finally {
      await rm(dirname(file.localPath), { recursive: true, force: true });
    }
  }
}

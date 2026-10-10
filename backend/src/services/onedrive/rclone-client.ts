/** Хеш, который OneDrive считает сам и который rclone умеет считать локально. */
export const HASH_TYPE = 'quickxor';

/** Файл в хранилище rclone: `fs` — корень (`onedrive:`), `path` — путь внутри него. */
export interface RemoteFile {
  fs: string;
  path: string;
}

export interface RemoteFileStat {
  size: number;
  modifiedAt: string;
  hash?: string;
}

/**
 * Минимальный набор операций rclone, нужный приложению.
 * Реализации: запуск процесса на каждую команду (CLI) и обращение к постоянному `rclone rcd`.
 */
export interface RcloneClient {
  /** Метаданные файла или undefined, если файла нет. */
  stat(file: RemoteFile): Promise<RemoteFileStat | undefined>;
  download(file: RemoteFile, localPath: string): Promise<void>;
  /** Загружает локальный файл поверх удалённого. */
  upload(localPath: string, file: RemoteFile): Promise<void>;
  /** Хеш локального файла того же типа, что считает OneDrive. */
  hashLocal(localPath: string): Promise<string>;
}

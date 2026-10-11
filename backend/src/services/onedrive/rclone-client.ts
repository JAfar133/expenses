/** A hash that OneDrive computes itself and rclone can compute locally. */
export const HASH_TYPE = 'quickxor';

/** A file in rclone storage: `fs` is the root (`onedrive:`), `path` is the path inside it. */
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
 * The minimal set of rclone operations the app needs.
 * Implementations: a process per command (CLI) and calls to a persistent `rclone rcd`.
 */
export interface RcloneClient {
  /** File metadata or undefined if there is no file. */
  stat(file: RemoteFile): Promise<RemoteFileStat | undefined>;
  download(file: RemoteFile, localPath: string): Promise<void>;
  /** Uploads a local file over the remote one. */
  upload(localPath: string, file: RemoteFile): Promise<void>;
  /** Hash of the local file of the same type that OneDrive computes. */
  hashLocal(localPath: string): Promise<string>;
}

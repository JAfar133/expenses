export interface RemoteFileMetadata {
  size: number;
  modifiedAt: string;
  /** QuickXorHash содержимого, считается самим OneDrive */
  hash: string;
  /** Идентификатор версии для проверки конфликтов: меняется при любом изменении файла */
  version: string;
}

export interface DownloadedFile {
  localPath: string;
  size: number;
  version: string;
}

export interface UploadResult {
  version: string;
}

export interface OneDriveService {
  getFileMetadata(): Promise<RemoteFileMetadata>;
  downloadFile(): Promise<DownloadedFile>;
  uploadFile(localPath: string, expectedVersion: string): Promise<UploadResult>;
}

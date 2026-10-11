export interface RemoteFileMetadata {
  size: number;
  modifiedAt: string;
  /** QuickXorHash of the content (lowercase), computed by OneDrive itself */
  hash: string;
  /** Version identifier for conflict checks: equals the content hash */
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

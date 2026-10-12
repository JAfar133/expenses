export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface ApiSuccess<T> {
  success: true;
  data: T;
  message?: string;
}

/** No response from the server: the request may or may not have arrived. */
export const NETWORK_ERROR_CODE = 'NETWORK';

/** These requests handle authentication themselves: refreshing the token and retrying on them is pointless. */
const AUTH_ENDPOINTS = ['/auth/login', '/auth/refresh', '/auth/logout'];

let refreshInFlight: Promise<void> | undefined;
let sessionLostHandler: (() => void) | undefined;

/** Called when sign-in is lost for good (refresh token invalid): time to show the login form. */
export function onSessionLost(handler: (() => void) | undefined): void {
  sessionLostHandler = handler;
}

async function send(path: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(`/api${path}`, {
      ...init,
      // Header only for requests with a body: Fastify answers 400 to a JSON request without a body
      headers: {
        ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...init.headers,
      },
    });
  } catch {
    throw new ApiError(0, NETWORK_ERROR_CODE, 'Нет соединения с сервером');
  }
}

/** The usual JSON error of the server as an `ApiError`. */
function toApiError(
  response: Response,
  body: { error?: { code?: string; message?: string } } | null,
) {
  return new ApiError(
    response.status,
    body?.error?.code ?? 'UNKNOWN',
    body?.error?.message ?? 'Неизвестная ошибка сервера',
  );
}

async function execute<T>(path: string, init: RequestInit): Promise<ApiSuccess<T>> {
  const response = await send(path, init);
  const body = await response.json().catch(() => null);

  if (!response.ok || body?.success === false) throw toApiError(response, body);
  return body as ApiSuccess<T>;
}

/**
 * Refreshes tokens via the refresh cookie. Parallel requests that got 401 simultaneously wait for one shared
 * refresh request: otherwise they would burn each other's refresh token.
 */
async function refreshSession(): Promise<void> {
  refreshInFlight ??= execute('/auth/refresh', { method: 'POST' })
    .then(() => undefined)
    .finally(() => {
      refreshInFlight = undefined;
    });

  try {
    await refreshInFlight;
  } catch (error) {
    // A server rejection (401) means sign-in is lost. A network failure does not cancel sign-in.
    if (error instanceof ApiError && error.status === 401) sessionLostHandler?.();
    throw error;
  }
}

export async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<ApiSuccess<T>> {
  try {
    return await execute<T>(path, init);
  } catch (error) {
    const expired = error instanceof ApiError && error.status === 401;
    if (!expired || AUTH_ENDPOINTS.some((endpoint) => path.startsWith(endpoint))) throw error;

    // The access token expired (lives a day): quietly get a new one and retry the request once
    await refreshSession();
    return execute<T>(path, init);
  }
}

/** A file received from the server. */
interface Download {
  blob: Blob;
  fileName: string;
}

/**
 * File name from Content-Disposition: `filename*=UTF-8''…` (decoded) first, then `filename="…"`,
 * otherwise the fallback.
 */
export function parseFileName(header: string | null, fallback: string): string {
  if (!header) return fallback;
  const star = /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(header)?.[1];
  if (star) {
    try {
      return decodeURIComponent(star.trim());
    } catch {
      // A malformed encoding: try the plain form
    }
  }
  const plain =
    /filename\s*=\s*"([^"]+)"/i.exec(header)?.[1] ?? /filename\s*=\s*([^;]+)/i.exec(header)?.[1];
  return plain?.trim() || fallback;
}

async function executeDownload(path: string, fallbackName: string): Promise<Download> {
  const response = await send(path, {});
  if (!response.ok) {
    throw toApiError(response, await response.json().catch(() => null));
  }
  return {
    blob: await response.blob(),
    fileName: parseFileName(response.headers.get('Content-Disposition'), fallbackName),
  };
}

/** Saves a blob as a file through a temporary link. */
function saveBlob({ blob, fileName }: Download): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/**
 * Downloads a file from the API (cookie authentication, the same refresh-and-retry on 401 as `apiRequest`)
 * and offers it to the browser. A JSON error of the server becomes an `ApiError`.
 */
export async function downloadFile(path: string, fallbackName: string): Promise<void> {
  let file: Download;
  try {
    file = await executeDownload(path, fallbackName);
  } catch (error) {
    if (!(error instanceof ApiError && error.status === 401)) throw error;
    // The access token expired: quietly get a new one and retry once
    await refreshSession();
    file = await executeDownload(path, fallbackName);
  }
  saveBlob(file);
}

const TOKEN_STORAGE_KEY = 'reffo_auth_token';

let currentToken: string | null =
  typeof window !== 'undefined' ? window.sessionStorage.getItem(TOKEN_STORAGE_KEY) : null;

export function setApiToken(token: string | null) {
  currentToken = token;
  if (typeof window !== 'undefined') {
    if (token) {
      window.sessionStorage.setItem(TOKEN_STORAGE_KEY, token);
    } else {
      window.sessionStorage.removeItem(TOKEN_STORAGE_KEY);
    }
  }
}

export function getApiToken(): string | null {
  return currentToken;
}

export class ApiError extends Error {
  readonly status: number;
  readonly payload: unknown;

  constructor(status: number, message: string, payload?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.payload = payload;
  }
}

let unauthorizedHandler: (() => void) | null = null;

export function setUnauthorizedHandler(handler: (() => void) | null) {
  unauthorizedHandler = handler;
}

function createApiError(status: number, payload: unknown, fallbackMessage: string): ApiError {
  const message =
    payload && typeof payload === 'object' && 'error' in payload
      ? String((payload as { error?: unknown }).error ?? fallbackMessage)
      : fallbackMessage;
  if (status === 401) {
    unauthorizedHandler?.();
  }
  return new ApiError(status, message, payload);
}

export async function apiFetch<T>(url: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (currentToken) {
    headers.set('Authorization', `Bearer ${currentToken}`);
  }
  if (!(options.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const res = await fetch(url, { ...options, headers, credentials: 'same-origin' });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) {
    throw createApiError(res.status, data, `Permintaan gagal (${res.status})`);
  }
  return data;
}

/**
 * Unduh file biner/CSV memakai header Authorization agar token sesi tidak
 * pernah tampil di URL query string maupun riwayat browser.
 */
export async function downloadAuthorized(url: string, fallbackFilename = 'download.csv'): Promise<void> {
  const headers = new Headers();
  if (currentToken) {
    headers.set('Authorization', `Bearer ${currentToken}`);
  }
  const res = await fetch(url, { headers, credentials: 'same-origin' });
  if (!res.ok) {
    const errBody = (await res.json().catch(() => ({}))) as { error?: string };
    throw createApiError(res.status, errBody, `Gagal mengunduh file (${res.status})`);
  }
  const blob = await res.blob();
  const disposition = res.headers.get('Content-Disposition') ?? '';
  const match = disposition.match(/filename="?([^"]+)"?/i);
  const filename = match?.[1] || fallbackFilename;
  const objectUrl = URL.createObjectURL(blob);
  try {
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

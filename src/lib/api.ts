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
    throw new Error(data.error || `Permintaan gagal (${res.status})`);
  }
  return data;
}

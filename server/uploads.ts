import path from 'node:path';

/** Cegah path traversal dan karakter aneh pada nama file upload. */
export function safeUploadFilename(value: string): string | null {
  const name = path.basename(value);
  if (!name || name === '.' || name === '..') return null;
  if (!/^[a-zA-Z0-9._-]+$/.test(name)) return null;
  return name;
}

/** Ubah path internal /uploads/... menjadi URL file ber-token Self-ACC. */
export function toPublicPreviewUrl(
  stored: string | null | undefined,
  token: string,
): string | null {
  if (!stored) return null;
  if (!stored.startsWith('/uploads/')) return stored;
  const name = safeUploadFilename(stored.slice('/uploads/'.length));
  return name
    ? `/api/public/approval/${encodeURIComponent(token)}/file/${encodeURIComponent(name)}`
    : null;
}

import crypto from 'node:crypto';
import type { UserRole } from '../src/types.ts';

let devFallbackSecret: string | null = null;
let warnedDevSecret = false;

/**
 * Secret dibaca lazily agar dotenv sempat dimuat sebelum modul ini dipakai.
 * Di produksi tidak ada fallback: server harus sudah divalidasi oleh
 * assertSecurityEnv() dan SESSION_SECRET wajib terisi.
 */
function getSessionSecret(): string {
  const configured = String(process.env.SESSION_SECRET ?? '').trim();
  if (configured) return configured;

  if (String(process.env.NODE_ENV ?? '').toLowerCase() === 'production') {
    throw new Error('SESSION_SECRET wajib diisi pada NODE_ENV=production.');
  }

  if (!devFallbackSecret) {
    devFallbackSecret = crypto.randomBytes(48).toString('hex');
  }
  if (!warnedDevSecret) {
    warnedDevSecret = true;
    console.warn(
      '[security] SESSION_SECRET kosong; memakai secret acak sementara untuk development. Token login akan hangus saat server restart.',
    );
  }
  return devFallbackSecret;
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt:${salt}:${derived}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  if (!storedHash.startsWith('scrypt:')) {
    return password === storedHash;
  }
  const parts = storedHash.split(':');
  if (parts.length !== 3) return false;
  const [, salt, hexKey] = parts;
  if (typeof salt !== 'string' || typeof hexKey !== 'string') return false;
  const derived = crypto.scryptSync(password, salt, 64);
  const keyBuf = Buffer.from(hexKey, 'hex');
  if (derived.length !== keyBuf.length) return false;
  return crypto.timingSafeEqual(derived, keyBuf);
}

export interface SessionPayload {
  uid: number;
  role: UserRole;
  exp: number;
}

export function signSessionToken(uid: number, role: UserRole): string {
  const payload: SessionPayload = {
    uid,
    role,
    exp: Date.now() + 7 * 24 * 60 * 60 * 1000,
  };
  const encoded = Buffer.from(JSON.stringify(payload), 'utf-8').toString('base64url');
  const sig = crypto.createHmac('sha256', getSessionSecret()).update(encoded).digest('base64url');
  return `${encoded}.${sig}`;
}

export function verifySessionToken(token: string | undefined | null): SessionPayload | null {
  if (!token || !token.includes('.')) return null;
  const [encoded, sig] = token.split('.');
  if (!encoded || !sig) return null;
  const expectedSig = crypto.createHmac('sha256', getSessionSecret()).update(encoded).digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }
  try {
    const parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf-8')) as SessionPayload;
    if (!parsed.uid || !parsed.exp || parsed.exp < Date.now()) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function parseCookie(cookieHeader: string | undefined, name: string): string | null {
  if (!cookieHeader) return null;
  const pairs = cookieHeader.split(';');
  for (const pair of pairs) {
    const idx = pair.indexOf('=');
    if (idx === -1) continue;
    const key = pair.slice(0, idx).trim();
    if (key === name) {
      return decodeURIComponent(pair.slice(idx + 1).trim());
    }
  }
  return null;
}

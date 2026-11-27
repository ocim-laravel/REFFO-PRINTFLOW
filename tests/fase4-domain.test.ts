import test from 'node:test';
import assert from 'node:assert/strict';
import { isSameOperationalDay } from '../server/domain.ts';
import { assertSecurityEnv } from '../server/security.ts';
import { parseCookie, signSessionToken, verifySessionToken } from '../server/auth.ts';

test('isSameOperationalDay membandingkan tanggal operasional lokal', () => {
  const ref = new Date(2026, 10, 27, 14, 30, 0);
  assert.equal(isSameOperationalDay('', ref), true);
  assert.equal(isSameOperationalDay(null, ref), true);
  assert.equal(isSameOperationalDay('2026-11-27', ref), true);
  assert.equal(isSameOperationalDay('2026-11-27T08:00:00.000Z', ref), true);
  assert.equal(isSameOperationalDay('2026-11-26', ref), false);
  assert.equal(isSameOperationalDay('2026-02-30', ref), false);
});

test('assertSecurityEnv melempar error pada produksi yang belum aman', () => {
  assert.throws(
    () =>
      assertSecurityEnv({
        NODE_ENV: 'production',
        SESSION_SECRET: 'pendek',
        WHATSAPP_WEBHOOK_TOKEN: '',
        WA_BRIDGE_TOKEN: '',
      }),
    /Konfigurasi keamanan belum aman/,
  );
  assert.doesNotThrow(() => assertSecurityEnv({ NODE_ENV: 'development' }));
});

test('token sesi ditandatangani, terverifikasi, dan menolak perubahan', () => {
  const token = signSessionToken(7, 'admin');
  assert.ok(token.includes('.'));
  const payload = verifySessionToken(token);
  assert.equal(payload?.uid, 7);
  assert.equal(payload?.role, 'admin');
  assert.ok(payload && payload.exp > Date.now());
  const parts = token.split('.');
  const tampered = `${parts[0]}.${parts[1] === 'a' ? 'b' : 'a'}`;
  assert.equal(verifySessionToken(tampered), null);
  assert.equal(verifySessionToken(''), null);
});

test('parseCookie mengambil dan mendekode cookie sesi', () => {
  assert.equal(parseCookie('reffo_session=abc%2Bdef; lain=1', 'reffo_session'), 'abc+def');
  assert.equal(parseCookie('lain=1', 'reffo_session'), null);
  assert.equal(parseCookie(undefined, 'reffo_session'), null);
});

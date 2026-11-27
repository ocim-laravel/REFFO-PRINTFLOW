import test from 'node:test';
import assert from 'node:assert/strict';
import { clampPercent, parsePositiveId, parseTanggalInput, round2 } from '../server/domain.ts';

test('parsePositiveId hanya menerima integer positif yang valid', () => {
  assert.equal(parsePositiveId('1'), 1);
  assert.equal(parsePositiveId(42), 42);
  assert.equal(parsePositiveId('0'), null);
  assert.equal(parsePositiveId('-5'), null);
  assert.equal(parsePositiveId('12.5'), null);
  assert.equal(parsePositiveId('abc'), null);
  assert.equal(parsePositiveId('12abc'), null);
  assert.equal(parsePositiveId(''), null);
});

test('parseTanggalInput memvalidasi YYYY-MM-DD dan ISO datetime secara ketat', () => {
  assert.deepEqual(parseTanggalInput(''), { valid: true, iso: null });
  assert.deepEqual(parseTanggalInput(undefined), { valid: true, iso: null });
  const okDate = parseTanggalInput('2026-12-31');
  assert.equal(okDate.valid, true);
  assert.equal(okDate.iso, '2026-12-31T00:00:00.000Z');

  assert.equal(parseTanggalInput('2026-02-30').valid, false);
  assert.equal(parseTanggalInput('2026-13-01').valid, false);
  assert.equal(parseTanggalInput('bukan-tanggal').valid, false);
  assert.equal(parseTanggalInput('31-12-2026').valid, false);
});

test('clampPercent membatasi persentase antara 0 hingga 100', () => {
  assert.equal(clampPercent(-5), 0);
  assert.equal(clampPercent(150), 100);
  assert.equal(clampPercent(11.256), 11.26);
  assert.equal(clampPercent('abc'), 0);
  assert.equal(round2(1.005), 1.01);
});

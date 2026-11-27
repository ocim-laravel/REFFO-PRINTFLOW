import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDefaultTaxSettings,
  computeEffectiveTaxRates,
  hitungPajakNota,
} from '../server/domain.ts';

test('hitungPajakNota mode belum_termasuk_ppn menghitung DPP, PPN 11%, dan PPh23 2%', () => {
  const res = hitungPajakNota({
    totalSebelumDiskonNota: 1_000_000,
    diskonNotaPersen: 10,
    ppnPersen: 11,
    pph23Persen: 2,
    modeHarga: 'belum_termasuk_ppn',
    ppnTermasukDiskon: true,
  });
  assert.equal(res.diskonNominal, 100_000);
  assert.equal(res.dpp, 900_000);
  assert.equal(res.ppnNominal, 99_000);
  assert.equal(res.pph23Nominal, 18_000);
  assert.equal(res.totalTagihan, 981_000);
});

test('hitungPajakNota mode sudah_termasuk_ppn mengekstrak DPP agar PPN tidak dihitung ganda', () => {
  const res = hitungPajakNota({
    totalSebelumDiskonNota: 1_110_000,
    diskonNotaPersen: 0,
    ppnPersen: 11,
    pph23Persen: 2,
    modeHarga: 'sudah_termasuk_ppn',
    ppnTermasukDiskon: true,
  });
  assert.equal(res.dpp, 1_000_000);
  assert.equal(res.ppnNominal, 110_000);
  assert.equal(res.pph23Nominal, 20_000);
  assert.equal(res.totalTagihan, 1_090_000);
});

test('computeEffectiveTaxRates mengikuti prioritas payload > instansi > global taxSettings', () => {
  const globalTax = { ...buildDefaultTaxSettings(), ppn_persen_default: 11, pph23_persen_default: 2, potong_pph23_otomatis: true };

  // Global fallback ketika instansi PKP tanpa angka khusus dan punya NPWP
  const fromGlobal = computeEffectiveTaxRates({
    instansi: { is_pkp: true, npwp: '01.234.567.8-901.000', ppn_persen: 0, pph23_persen: 0 },
    taxSettings: globalTax,
  });
  assert.deepEqual(fromGlobal, { ppnPersen: 11, pph23Persen: 2 });

  // Override instansi mengalahkan global
  const fromInstansi = computeEffectiveTaxRates({
    instansi: { is_pkp: true, ppn_persen: 12, pph23_persen: 1.5 },
    taxSettings: globalTax,
  });
  assert.deepEqual(fromInstansi, { ppnPersen: 12, pph23Persen: 1.5 });

  // Override payload mengalahkan instansi & global
  const fromPayload = computeEffectiveTaxRates({
    payloadPpn: 0,
    payloadPph23: 4,
    instansi: { is_pkp: true, ppn_persen: 11, pph23_persen: 2 },
    taxSettings: globalTax,
  });
  assert.deepEqual(fromPayload, { ppnPersen: 0, pph23Persen: 4 });
});

test('computeEffectiveTaxRates: instansi non-PKP dengan PPN 0 tetap ikut default global', () => {
  const globalTax = { ...buildDefaultTaxSettings(), ppn_persen_default: 11, pph23_persen_default: 2 };

  const nonPkp = computeEffectiveTaxRates({
    instansi: { is_pkp: false, npwp: null, ppn_persen: 0, pph23_persen: 0 },
    taxSettings: globalTax,
  });
  assert.deepEqual(nonPkp, { ppnPersen: 11, pph23Persen: 0 });
});

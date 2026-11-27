import test from 'node:test';
import assert from 'node:assert/strict';
import {
  hitungPemakaianBahanPrn,
  hitungPemakaianTintaPerWarna,
  hitungTintaMlPerM2,
  isEditableMasterFilename,
  isTiffFilename,
  resolveBulkTiffMapping,
  resolveQcStatus,
  statusSetelahCetak,
} from '../server/domain.ts';

test('isEditableMasterFilename hanya menerima .ai, .psd, .cdr', () => {
  assert.equal(isEditableMasterFilename('desain.cdr'), true);
  assert.equal(isEditableMasterFilename('LAYOUT.AI'), true);
  assert.equal(isEditableMasterFilename('poster.psd'), true);
  assert.equal(isEditableMasterFilename('mockup.jpg'), false);
  assert.equal(isEditableMasterFilename('final.pdf'), false);
  assert.equal(isEditableMasterFilename('cetak.tif'), false);
  assert.equal(isEditableMasterFilename('arsip.zip'), false);
});

test('isTiffFilename hanya menerima .tif dan .tiff', () => {
  assert.equal(isTiffFilename('banner.tif'), true);
  assert.equal(isTiffFilename('banner.TIFF'), true);
  assert.equal(isTiffFilename('banner.png'), false);
});

test('resolveBulkTiffMapping memetakan file dengan peta eksplisit dan menolak item belum ACC', () => {
  const items = [
    { id: 10, nama_item: 'Spanduk A', acc_admin_id: 2 },
    { id: 11, nama_item: 'Banner B', acc_admin_id: 2 },
    { id: 12, nama_item: 'Stiker C', acc_admin_id: null },
  ];

  const ok = resolveBulkTiffMapping({
    filenames: ['file-satu.tif', 'file-dua.tiff'],
    items,
    explicitMap: [
      { filename: 'file-satu.tif', item_id: 10 },
      { filename: 'file-dua.tiff', item_id: 11 },
    ],
  });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.mappings, [
    { filename: 'file-satu.tif', itemId: 10 },
    { filename: 'file-dua.tiff', itemId: 11 },
  ]);

  const unapproved = resolveBulkTiffMapping({
    filenames: ['file-c.tif'],
    items,
    explicitMap: [{ filename: 'file-c.tif', item_id: 12 }],
  });
  assert.equal(unapproved.ok, false);
  assert.ok(unapproved.errors[0]?.includes('belum di-ACC Admin'));

  const missingMap = resolveBulkTiffMapping({
    filenames: ['random-name.tif'],
    items,
  });
  assert.equal(missingMap.ok, false);
  assert.deepEqual(missingMap.unmapped, ['random-name.tif']);
});

test('resolveQcStatus menerjemahkan hasil QC ke status produksi', () => {
  assert.equal(resolveQcStatus('lolos'), 'proses_finishing');
  assert.equal(resolveQcStatus('cacat'), 'cetak_ulang');
  assert.equal(resolveQcStatus('ragu-ragu'), null);
  assert.equal(resolveQcStatus(undefined), null);
});

test('konversi tinta 1 galon per 6 roll 3.2x70 menghasilkan 3.72 ml/m2', () => {
  assert.equal(hitungTintaMlPerM2(), 3.72);
  const pakai = hitungPemakaianTintaPerWarna(10, [
    { id: 1, warna: 'C', konsumsi_ml_per_m2: 3.72 },
  ]);
  assert.equal(pakai.totalMl, 37.2);
  assert.deepEqual(pakai.rincian, [{ tinta_warna_id: 1, warna: 'C', jumlah_ml: 37.2 }]);
});

test('hitungPemakaianBahanPrn memisahkan offcut manual dan WOS', () => {
  const tanpaOffcut = hitungPemakaianBahanPrn({
    panjangFileM: 10,
    lebarFileM: 3,
    containerWidthM: 3.2,
  });
  assert.equal(tanpaOffcut.wosPotongM2, 2);
  assert.equal(tanpaOffcut.createsManualOffcut, false);

  const denganOffcut = hitungPemakaianBahanPrn({
    panjangFileM: 10,
    lebarFileM: 3,
    containerWidthM: 3.2,
    manualOffcutLebarM: 0.2,
    manualOffcutPanjangM: 10,
  });
  assert.equal(denganOffcut.offcutLuasM2, 2);
  assert.equal(denganOffcut.wosPotongM2, 0);
  assert.equal(denganOffcut.createsManualOffcut, true);
});

test('statusSetelahCetak menentukan item selesai bila qty terakumulasi cukup', () => {
  assert.equal(statusSetelahCetak(5, 4), 'antrean_cetak');
  assert.equal(statusSetelahCetak(5, 5), 'selesai');
  assert.equal(statusSetelahCetak(5, 6), 'selesai');
});

test('resolveBulkTiffMapping fallback mengenali pola item-<id> dan indeks urut', () => {
  const items = [
    { id: 21, nama_item: 'Spanduk', acc_admin_id: 2 },
    { id: 22, nama_item: 'Stiker', acc_admin_id: 2 },
  ];
  const res = resolveBulkTiffMapping({
    filenames: ['item-21-spanduk.tif', '2_stiker.tiff'],
    items,
  });
  assert.equal(res.ok, true);
  assert.deepEqual(res.mappings, [
    { filename: 'item-21-spanduk.tif', itemId: 21 },
    { filename: '2_stiker.tiff', itemId: 22 },
  ]);
});

/**
 * Smoke test alur end-to-end Reffo PrintFlow.
 * Menjalankan alur: auth → nota → desain → self-ACC → ACC admin → TIFF/master
 * → cetak → QC finishing → pelunasan → serah terima → laporan owner → purchasing.
 *
 * Pakai server terpisah supaya data operasional tidak berubah:
 *   SMOKE_BASE_URL=http://127.0.0.1:3100 \
 *   SMOKE_CREDENTIALS=/path/ke/data/initial-credentials.txt \
 *   node tests/smoke-flow.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const BASE = (process.env.SMOKE_BASE_URL ?? 'http://127.0.0.1:3100').replace(/\/$/, '');
const CRED_FILE = process.env.SMOKE_CREDENTIALS ?? path.join('data', 'initial-credentials.txt');
const credentials = {};
for (const line of fs.readFileSync(CRED_FILE, 'utf8').split(/\r?\n/)) {
  if (!line.trim() || line.trim().startsWith('#')) continue;
  const [role, email, password] = line.trim().split(/\s+/);
  credentials[role] = { email, password };
}

const tokens = {};
let passed = 0;
const failures = [];

async function api(method, url, { token, body, form } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload;
  if (form) payload = form;
  else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const response = await fetch(`${BASE}${url}`, {
    method,
    headers,
    body: payload,
    redirect: 'manual',
  });
  const text = await response.text();
  let data = text;
  try {
    data = JSON.parse(text);
  } catch {
    /* teks biasa (CSV/HTML) */
  }
  return { status: response.status, data, headers: response.headers, text };
}

async function step(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  OK   ${name}`);
  } catch (error) {
    failures.push({ name, error });
    console.log(`  FAIL ${name}: ${error.message}`);
    throw error;
  }
}

function file(field, filename, bytes, type = 'application/octet-stream') {
  const form = new FormData();
  form.append(field, new Blob([bytes], { type }), filename);
  return form;
}

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
  'base64',
);
const expectStatus = (res, status) =>
  assert.equal(res.status, status, `HTTP ${res.status}: ${JSON.stringify(res.data).slice(0, 300)}`);

async function login(role) {
  const res = await api('POST', '/api/auth/login', { body: credentials[role] });
  expectStatus(res, 200);
  assert.equal(res.data.user.role, role);
  tokens[role] = res.data.token;
  return res.data;
}

console.log(`Smoke alur: ${BASE}`);

await step('akses tanpa login ditolak (/api/bootstrap, /uploads)', async () => {
  expectStatus(await api('GET', '/api/bootstrap'), 401);
  const upload = await api('GET', '/uploads/tidak-ada.png');
  assert.ok([401, 403].includes(upload.status), `uploads status ${upload.status}`);
});

await step('login 6 peran + password salah ditolak', async () => {
  for (const role of Object.keys(credentials)) await login(role);
  expectStatus(await api('POST', '/api/auth/login', {
    body: { email: credentials.admin.email, password: 'salah' },
  }), 401);
});

await step('demo switch nonaktif', async () => {
  const accounts = await api('GET', '/api/auth/accounts');
  expectStatus(accounts, 200);
  assert.equal(accounts.data.demo_switch_enabled, false);
  assert.deepEqual(accounts.data.accounts, []);
  expectStatus(await api('POST', '/api/auth/switch', { body: { userId: 1 } }), 403);
});

await step('admin login langsung membuka shift sendiri', async () => {
  const res = await api('GET', '/api/shifts/current', { token: tokens.admin });
  expectStatus(res, 200);
  assert.equal(res.data.shift.status, 'buka');
});

await step('bootstrap memuat master baru (pajak, tinta,cattoff, mesin)', async () => {
  const res = await api('GET', '/api/bootstrap', { token: tokens.admin });
  expectStatus(res, 200);
  assert.ok(res.data.tax_settings);
  assert.ok(res.data.tinta_warna.length > 0);
  assert.ok(res.data.cattoffs.length > 0);
  assert.ok(res.data.machines.length > 0);
});

await step('pembatasan peran endpoint', async () => {
  expectStatus(await api('POST', '/api/orders', { token: tokens.desainer, body: {} }), 403);
  expectStatus(await api('GET', '/api/owner/dashboard', { token: tokens.advertising }), 403);
  expectStatus(await api('GET', '/api/operator/queue', { token: tokens.owner }), 403);
  expectStatus(await api('GET', '/api/orders', { token: tokens.advertising }), 403);
});

await step('validasi tanggal, item, dan SPK sebelum nota dibuat', async () => {
  const before = await api('GET', '/api/orders', { token: tokens.admin });
  const orderBody = {
    nama_pelanggan: 'Test Smoke',
    no_wa: '081200000000',
    kategori: 'umum',
    status_bayar: 'dp',
    jumlah_dp: 10000,
    items: [{ product_id: 1, lebar_m: 1, tinggi_m: 1, qty: 1 }],
  };
  expectStatus(await api('POST', '/api/orders', {
    token: tokens.admin,
    body: { ...orderBody, jatuh_tempo: '2026-02-30' },
  }), 422);
  expectStatus(await api('POST', '/api/orders', {
    token: tokens.admin,
    body: { ...orderBody, items: [] },
  }), 422);
  expectStatus(await api('POST', '/api/orders', {
    token: tokens.admin,
    body: { ...orderBody, spk_enabled: true },
  }), 422);
  const after = await api('GET', '/api/orders', { token: tokens.admin });
  assert.equal(after.data.orders.length, before.data.orders.length, 'nota yatim tidak boleh dibuat');
});

let orderId;
let itemId;
let approvalToken;
await step('buat nota: pajak, DP, Self-ACC', async () => {
  const res = await api('POST', '/api/orders', {
    token: tokens.admin,
    body: {
      nama_pelanggan: 'Test Smoke',
      no_wa: '081200000000',
      kategori: 'umum',
      status_bayar: 'dp',
      jumlah_dp: 10000,
      self_acc: true,
      items: [{ product_id: 1, finishing_id: 1, lebar_m: 1, tinggi_m: 1, qty: 1 }],
    },
  });
  expectStatus(res, 201);
  const order = res.data.order;
  orderId = order.id;
  itemId = order.items[0].id;
  approvalToken = order.approval_token;
  assert.ok(approvalToken);
  assert.equal(order.status_bayar, 'dp');
  assert.equal(order.ppn_persen, 11);
  assert.equal(order.ppn_nominal, 3300);
  assert.equal(order.total_tagihan, 33300);
  assert.equal(order.items[0].status_produksi, 'menunggu_desain');
});

await step('riwayat Advertising menyembunyikan seluruh nominal', async () => {
  const res = await api('GET', '/api/riwayat/semua', { token: tokens.advertising });
  expectStatus(res, 200);
  const order = res.data.orders.find((o) => o.id === orderId);
  assert.ok(order);
  assert.equal(order.total_tagihan, 0);
  assert.equal(order.jumlah_dp, 0);
  assert.equal(order.sisa_tagihan, 0);
  assert.deepEqual(order.payments, []);
  assert.ok(order.items.every((i) => i.subtotal === 0 && i.harga_satuan_dipakai === 0));
});

await step('desainer terima job + preview wajib file', async () => {
  const queue = await api('GET', '/api/desainer/queue', { token: tokens.desainer });
  expectStatus(queue, 200);
  assert.ok(queue.data.orders.some((o) => o.id === orderId));
  expectStatus(await api('POST', `/api/desainer/orders/${orderId}/terima`, { token: tokens.desainer }), 200);
  expectStatus(await api('POST', `/api/desainer/orders/${orderId}/preview`, {
    token: tokens.desainer,
    body: { catatan: 'tanpa file' },
  }), 422);
  const preview = await api('POST', `/api/desainer/orders/${orderId}/preview`, {
    token: tokens.desainer,
    form: file('file_preview', 'preview.png', PNG, 'image/png'),
  });
  expectStatus(preview, 200);
  assert.equal(preview.data.order.items[0].status_produksi, 'menunggu_acc');
});

await step('WA outbox mencatat nota_dibuat & preview_siap_acc', async () => {
  const res = await api('GET', '/api/owner/whatsapp-outbox', { token: tokens.owner });
  expectStatus(res, 200);
  const events = res.data.outbox.map((m) => m.event);
  assert.ok(events.includes('nota_dibuat'));
  assert.ok(events.includes('preview_siap_acc'));
});

await step('TIFF ditolak sebelum ACC admin', async () => {
  const res = await api('POST', `/api/desainer/items/${itemId}/tiff`, {
    token: tokens.desainer,
    form: file('file_cetak_tiff', 'cetak.tif', Buffer.from('tif')),
  });
  expectStatus(res, 422);
});

await step('Self-ACC: token salah, revisi, ACC pelanggan, duplikat ditolak', async () => {
  expectStatus(await api('GET', '/api/public/approval/tidak-ada', {}), 404);
  const detail = await api('GET', `/api/public/approval/${approvalToken}`);
  expectStatus(detail, 200);
  assert.equal(detail.data.order.total_tagihan, 0, 'belum ACC → nominal 0');
  expectStatus(await api('POST', `/api/public/approval/${approvalToken}`, {
    body: { decision: 'revisi' },
  }), 422);
  expectStatus(await api('POST', `/api/public/approval/${approvalToken}`, {
    body: { decision: 'revisi', note: 'perbesar tulisan', nama: 'Pelanggan Test' },
  }), 200);
  const queue = await api('GET', '/api/desainer/queue', { token: tokens.desainer });
  assert.equal(queue.data.orders.find((o) => o.id === orderId).items[0].status_produksi, 'revisi');
  const preview = await api('POST', `/api/desainer/orders/${orderId}/preview`, {
    token: tokens.desainer,
    form: file('file_preview', 'preview-revisi.png', PNG, 'image/png'),
  });
  expectStatus(preview, 200);
  expectStatus(await api('POST', `/api/public/approval/${approvalToken}`, {
    body: { decision: 'disetujui', nama: 'Pelanggan Test' },
  }), 200);
  expectStatus(await api('POST', `/api/public/approval/${approvalToken}`, {
    body: { decision: 'disetujui' },
  }), 409);
});

await step('ACC admin memisahkan jejak ACC admin & pelanggan', async () => {
  const res = await api('POST', `/api/admin/design-reviews/${orderId}/approve`, { token: tokens.admin });
  expectStatus(res, 200);
  const detail = await api('GET', `/api/orders/${orderId}`, { token: tokens.admin });
  expectStatus(detail, 200);
  const item = detail.data.order.items.find((i) => i.id === itemId);
  assert.ok(item.acc_admin_id);
  assert.ok(item.acc_pelanggan_at);
  assert.equal(item.acc_pelanggan_nama, 'Pelanggan Test');
});

await step('upload TIFF per item, massal, dan master editable', async () => {
  expectStatus(await api('POST', `/api/desainer/items/${itemId}/tiff`, {
    token: tokens.desainer,
    form: file('file_cetak_tiff', 'item-satu.tif', Buffer.from('tif')),
  }), 200);
  expectStatus(await api('POST', `/api/desainer/orders/${orderId}/tiff-massal`, {
    token: tokens.desainer,
    form: file('files', 'tanpa-peta.tif', Buffer.from('tif')),
  }), 422);
  expectStatus(await api('POST', `/api/desainer/orders/${orderId}/tiff-massal`, {
    token: tokens.desainer,
    form: file('files', `item-${itemId}-cetak.tiff`, Buffer.from('tif')),
  }), 200);
  expectStatus(await api('POST', `/api/desainer/orders/${orderId}/master`, {
    token: tokens.desainer,
    form: file('file_master_arsip', 'master.pdf', Buffer.from('%PDF')),
  }), 422);
  const master = await api('POST', `/api/desainer/orders/${orderId}/master`, {
    token: tokens.desainer,
    form: file('file_master_arsip', 'master.cdr', Buffer.from('CDR')),
  });
  expectStatus(master, 200);
  assert.equal(master.data.order.items[0].status_produksi, 'antrean_cetak');
});

await step('operator: mulai, cattoff + tinta per warna, WOS tanpa offcut', async () => {
  const queue = await api('GET', '/api/operator/queue', { token: tokens.operator_cetak });
  expectStatus(queue, 200);
  assert.ok(queue.data.items.some((i) => i.id === itemId));
  expectStatus(await api('POST', `/api/operator/items/${itemId}/mulai`, { token: tokens.operator_cetak }), 200);
  const before = await api('GET', '/api/bootstrap', { token: tokens.operator_cetak });
  const tintaSebelum = before.data.tinta_warna.filter((w) => [1, 2].includes(w.id));
  const res = await api('POST', `/api/operator/items/${itemId}/selesai`, {
    token: tokens.operator_cetak,
    body: {
      sumber_bahan: 'cattoff',
      cattoff_id: 1,
      panjang_file_m: 1,
      lebar_file_m: 1,
      warna_tinta_ids: [1, 2],
    },
  });
  expectStatus(res, 200);
  assert.equal(res.data.item.status_produksi, 'antrean_finishing');
  assert.equal(res.data.estimasi_tinta_ml, 7.44);
  assert.equal(res.data.rincian_tinta.length, 2);
  const after = await api('GET', '/api/bootstrap', { token: tokens.operator_cetak });
  for (const warna of after.data.tinta_warna.filter((w) => [1, 2].includes(w.id))) {
    const previous = tintaSebelum.find((w) => w.id === warna.id);
    assert.equal(Math.round((previous.stok_ml - warna.stok_ml) * 100) / 100, 3.72);
  }
  const materials = await api('GET', '/api/owner/reports/materials', { token: tokens.owner });
  expectStatus(materials, 200);
  const log = materials.data.logs.find((l) => l.order_item_id === itemId);
  assert.ok(log);
  assert.ok(log.wos_potong_m2 > 0, 'sisa tanpa input offcut wajib masuk WOS');
});

await step('finishing: QC cacat → cetak ulang → lolos → foto bukti', async () => {
  expectStatus(await api('POST', `/api/finishing/items/${itemId}/qc`, {
    token: tokens.finishing,
    body: { hasil: 'cacat', catatan: 'tinta luntur' },
  }), 422);
  expectStatus(await api('POST', `/api/finishing/items/${itemId}/qc`, {
    token: tokens.finishing,
    form: (() => {
      const f = file('foto', 'cacat.png', PNG, 'image/png');
      f.append('hasil', 'ragu-ragu');
      return f;
    })(),
  }), 422);
  const cacat = await api('POST', `/api/finishing/items/${itemId}/qc`, {
    token: tokens.finishing,
    form: (() => {
      const f = file('foto', 'cacat.png', PNG, 'image/png');
      f.append('hasil', 'cacat');
      f.append('catatan', 'tinta luntur');
      return f;
    })(),
  });
  expectStatus(cacat, 200);
  assert.equal(cacat.data.item.status_produksi, 'cetak_ulang');
  assert.ok(cacat.data.item.foto_cetak_ulang);
  expectStatus(await api('POST', `/api/operator/items/${itemId}/mulai`, { token: tokens.operator_cetak }), 200);
  expectStatus(await api('POST', `/api/operator/items/${itemId}/selesai`, {
    token: tokens.operator_cetak,
    body: {
      sumber_bahan: 'roll',
      material_roll_id: 2,
      panjang_file_m: 1,
      lebar_file_m: 1,
      offcut_lebar_m: 0.2,
      offcut_panjang_m: 1,
    },
  }), 200);
  const lolos = await api('POST', `/api/finishing/items/${itemId}/qc`, {
    token: tokens.finishing,
    form: (() => {
      const f = file('foto', 'lolos.png', PNG, 'image/png');
      f.append('hasil', 'lolos');
      return f;
    })(),
  });
  expectStatus(lolos, 200);
  assert.equal(lolos.data.item.status_produksi, 'proses_finishing');
  expectStatus(await api('POST', `/api/finishing/items/${itemId}/konfirmasi`, {
    token: tokens.finishing,
    body: { catatan: 'tanpa foto' },
  }), 422);
  const selesai = await api('POST', `/api/finishing/items/${itemId}/konfirmasi`, {
    token: tokens.finishing,
    form: (() => {
      const f = file('foto', 'finishing.png', PNG, 'image/png');
      f.append('catatan', 'selesai rapi');
      return f;
    })(),
  });
  expectStatus(selesai, 200);
  assert.equal(selesai.data.item.status_produksi, 'siap_diambil');
  assert.ok(selesai.data.item.foto_finishing);
});

await step('pelunasan & serah terima', async () => {
  expectStatus(await api('POST', `/api/orders/${orderId}/serah-terima`, {
    token: tokens.admin,
    body: { nama_pengambil: 'Test', no_wa_pengambil: '081200000000' },
  }), 403, 'belum lunas');
  expectStatus(await api('POST', `/api/orders/${orderId}/pelunasan`, {
    token: tokens.admin,
    body: { metode: 'Tunai' },
  }), 200);
  const serah = await api('POST', `/api/orders/${orderId}/serah-terima`, {
    token: tokens.admin,
    body: { nama_pengambil: 'Test', no_wa_pengambil: '081200000000' },
  });
  expectStatus(serah, 200);
  assert.equal(serah.data.order.items[0].status_produksi, 'selesai');
});

await step('laporan & ekspor Owner memakai header Authorization', async () => {
  for (const url of [
    '/api/owner/reports/finance',
    '/api/owner/reports/materials',
    '/api/owner/reports/profit-loss',
    '/api/owner/dashboard',
  ]) expectStatus(await api('GET', url, { token: tokens.owner }), 200);
  expectStatus(await api('GET', '/api/owner/reports/export?type=orders'), 401);
  const csv = await api('GET', '/api/owner/reports/export?type=orders', { token: tokens.owner });
  expectStatus(csv, 200);
  assert.match(csv.headers.get('content-disposition'), /attachment/);
});

await step('pengaturan pajak baru dipakai nota berikutnya, lalu dikembalikan', async () => {
  const original = (await api('GET', '/api/settings/tax', { token: tokens.admin })).data.tax_settings;
  expectStatus(await api('PUT', '/api/owner/settings/tax', {
    token: tokens.owner,
    body: { ...original, ppn_persen_default: 10 },
  }), 200);
  const created = await api('POST', '/api/orders', {
    token: tokens.admin,
    body: {
      nama_pelanggan: 'Test Pajak',
      no_wa: '081200000001',
      kategori: 'umum',
      status_bayar: 'belum_lunas',
      items: [{ product_id: 6, qty: 1 }],
    },
  });
  expectStatus(created, 201);
  assert.equal(created.data.order.ppn_persen, 10);
  expectStatus(await api('PUT', '/api/owner/settings/tax', {
    token: tokens.owner,
    body: { ...original },
  }), 200);
  const voidRes = await api('POST', `/api/orders/${created.data.order.id}/void`, {
    token: tokens.admin,
    body: { alasan_batal: 'SMOKE: nota uji pajak' },
  });
  expectStatus(voidRes, 200);
  assert.equal(voidRes.data.order.status_nota, 'batal');
  assert.ok(voidRes.data.order.items.every((i) => i.status_produksi === 'dibatalkan'));
});

await step('purchasing: supplier, PO draft, edit, kirim, terima, bayar', async () => {
  const supplier = await api('POST', '/api/owner/suppliers', {
    token: tokens.owner,
    body: { nama_supplier: 'Supplier Smoke', no_wa: '081200000002' },
  });
  expectStatus(supplier, 201);
  const supplierId = supplier.data.supplier.id;
  expectStatus(await api('PUT', `/api/owner/suppliers/${supplierId}`, {
    token: tokens.owner,
    body: { kode_supplier: supplier.data.supplier.kode_supplier, nama_supplier: 'Supplier Smoke Edit' },
  }), 200);
  const po = await api('POST', '/api/owner/purchase-orders', {
    token: tokens.owner,
    body: {
      supplier_id: supplierId,
      tanggal: new Date().toISOString().slice(0, 10),
      items: [{ jenis: 'roll', referensi_id: 2, qty: 5, harga_satuan: 1000 }],
    },
  });
  expectStatus(po, 201);
  const poId = po.data.purchase_order.id;
  expectStatus(await api('GET', `/api/owner/purchase-orders/${poId}`, { token: tokens.owner }), 200);
  expectStatus(await api('PUT', `/api/owner/purchase-orders/${poId}`, {
    token: tokens.owner,
    body: { supplier_id: supplierId, catatan: 'SMOKE edit draft' },
  }), 200);
  expectStatus(await api('POST', `/api/owner/purchase-orders/${poId}/kirim`, { token: tokens.owner }), 200);
  expectStatus(await api('POST', `/api/owner/purchase-orders/${poId}/terima`, { token: tokens.owner }), 200);
  expectStatus(await api('POST', `/api/owner/purchase-orders/${poId}/bayar`, {
    token: tokens.owner,
    body: { nominal: 5000, metode: 'Transfer' },
  }), 200);
  expectStatus(await api('POST', `/api/owner/suppliers/${supplierId}/nonaktif`, { token: tokens.owner }), 200);
});

console.log(`\nSelesai: ${passed} alur lulus, ${failures.length} gagal.`);
if (failures.length) process.exit(1);

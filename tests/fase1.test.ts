import test from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword } from '../server/auth.ts';
import { validateSecurityEnv } from '../server/security.ts';
import { safeUploadFilename, toPublicPreviewUrl } from '../server/uploads.ts';
import { SYNC_TABLES, MySqlAdapter } from '../server/mysql-adapter.ts';

const productionEnv = {
  NODE_ENV: 'production',
  SESSION_SECRET: 'a'.repeat(64),
  WHATSAPP_WEBHOOK_TOKEN: 'wa-token-yang-panjang',
  WA_BRIDGE_TOKEN: 'wa-token-yang-panjang',
  ENABLE_DEMO_SWITCH: 'false',
};

test('produksi menolak SESSION_SECRET kosong', () => {
  const result = validateSecurityEnv({ ...productionEnv, SESSION_SECRET: '' });
  assert.ok(result.errors.some((message) => message.includes('SESSION_SECRET')));
});

test('produksi menolak SESSION_SECRET pendek', () => {
  const result = validateSecurityEnv({ ...productionEnv, SESSION_SECRET: 'pendek' });
  assert.ok(result.errors.some((message) => message.includes('terlalu pendek')));
});

test('produksi menolak token WhatsApp kosong', () => {
  const result = validateSecurityEnv({
    ...productionEnv,
    WHATSAPP_WEBHOOK_TOKEN: '',
    WA_BRIDGE_TOKEN: '',
  });
  assert.ok(result.errors.some((message) => message.includes('WHATSAPP_WEBHOOK_TOKEN')));
  assert.ok(result.errors.some((message) => message.includes('WA_BRIDGE_TOKEN')));
});

test('produksi menolak demo switch aktif', () => {
  const result = validateSecurityEnv({ ...productionEnv, ENABLE_DEMO_SWITCH: 'true' });
  assert.ok(result.errors.some((message) => message.includes('ENABLE_DEMO_SWITCH')));
});

test('konfigurasi produksi lengkap lolos tanpa error', () => {
  const result = validateSecurityEnv(productionEnv);
  assert.deepEqual(result.errors, []);
});

test('development hanya memberi peringatan, tidak memblokir', () => {
  const result = validateSecurityEnv({ NODE_ENV: 'development' });
  assert.deepEqual(result.errors, []);
  assert.ok(result.warnings.length > 0);
});

test('hash password scrypt bisa diverifikasi dan menolak password salah', () => {
  const hash = hashPassword('rahasia-baru-123');
  assert.equal(verifyPassword('rahasia-baru-123', hash), true);
  assert.equal(verifyPassword('password123', hash), false);
});

test('password default lama terdeteksi untuk migrasi', () => {
  assert.equal(verifyPassword('password123', hashPassword('password123')), true);
});

test('nama file upload tidak membawa path traversal', () => {
  assert.equal(safeUploadFilename('../../etc/passwd'), 'passwd');
  assert.equal(safeUploadFilename('foto serah terima.png'), null);
  assert.equal(safeUploadFilename(''), null);
});

test('URL preview Self-ACC memakai token nota', () => {
  assert.equal(
    toPublicPreviewUrl('/uploads/123-preview.png', 'tok-abc'),
    '/api/public/approval/tok-abc/file/123-preview.png',
  );
  assert.equal(toPublicPreviewUrl('https://cdn.example.com/a.png', 'tok'), 'https://cdn.example.com/a.png');
  assert.equal(toPublicPreviewUrl(null, 'tok'), null);
});

test('daftar tabel sinkronisasi tidak duplikat', () => {
  assert.equal(new Set(SYNC_TABLES).size, SYNC_TABLES.length);
  assert.ok(SYNC_TABLES.includes('orders'));
  assert.ok(SYNC_TABLES.includes('order_items'));
  assert.ok(SYNC_TABLES.includes('material_rolls'));
  assert.ok(SYNC_TABLES.includes('supplies'));
  for (const table of [
    'stok_cattoff',
    'tinta_warna',
    'cetak_grup',
    'cetak_grup_item',
    'pemakaian_tinta',
  ] as const) {
    assert.ok(SYNC_TABLES.includes(table), `tabel ${table} wajib disinkronkan`);
  }
  const parentBeforeChild = (
    parent: (typeof SYNC_TABLES)[number],
    child: (typeof SYNC_TABLES)[number],
  ) =>
    assert.ok(
      SYNC_TABLES.indexOf(parent) < SYNC_TABLES.indexOf(child),
      `${parent} harus sebelum ${child}`,
    );
  parentBeforeChild('cetak_grup', 'cetak_grup_item');
  parentBeforeChild('cetak_grup_item', 'pemakaian_tinta');
  parentBeforeChild('tinta_warna', 'pemakaian_tinta');
});

test('CRUD diff hanya menulis baris baru/berubah/terhapus', async () => {
  const emptyState = {
    users: [],
    instansis: [],
    customers: [],
    products: [],
    finishings: [],
    material_rolls: [],
    material_offcuts: [],
    machines: [],
    supplies: [],
    supply_usages: [],
    print_batches: [],
    orders: [],
    order_items: [],
    order_payments: [],
    design_revisions: [],
    advertising_spks: [],
    material_logs: [],
    operational_expenses: [],
    shifts: [],
    suppliers: [],
    purchase_orders: [],
    goods_receipts: [],
    supplier_payments: [],
    whatsapp_outbox: [],
    whatsapp_gateway_config: null,
    tax_settings: null,
    audit_logs: [],
    insentif_rates: [],
    counters: {},
  };
  const adapter = new MySqlAdapter() as unknown as {
    tableColumnsLoaded: boolean;
    tableColumns: Map<string, string[]>;
    lastPersisted: unknown;
    persistDiff: (conn: unknown, state: unknown) => Promise<void>;
  };
  adapter.tableColumnsLoaded = true;
  adapter.tableColumns = new Map([
    ['instansis', ['id', 'nama_instansi', 'is_pkp', 'ppn_persen']],
  ]);
  adapter.lastPersisted = {
    ...emptyState,
    instansis: [{ id: 1, nama_instansi: 'Lama', is_pkp: 0, ppn_persen: 0 }],
  };

  const queries: Array<{ sql: string; params: unknown[] }> = [];
  const conn = {
    query: async (sql: string, params: unknown[] = []) => {
      queries.push({ sql, params });
      return [{}, []];
    },
  };

  const inserted = {
    ...emptyState,
    instansis: [
      { id: 1, nama_instansi: 'Lama', is_pkp: 0, ppn_persen: 0 },
      { id: 2, nama_instansi: 'Baru' },
    ],
  };
  await adapter.persistDiff(conn, inserted);
  const insert = queries.find((q) => q.sql.startsWith('INSERT INTO `instansis`'));
  assert.ok(insert, 'harus ada INSERT instansis');
  assert.match(insert!.sql, /\(`id`, `nama_instansi`\)/);
  assert.deepEqual(insert!.params, [2, 'Baru']);
  assert.ok(!queries.some((q) => q.sql.startsWith('DELETE FROM `instansis`')));

  adapter.lastPersisted = inserted;
  queries.length = 0;
  const updated = {
    ...inserted,
    instansis: [
      { id: 1, nama_instansi: 'Lama Diubah', is_pkp: 0, ppn_persen: 0 },
      { id: 2, nama_instansi: 'Baru' },
    ],
  };
  await adapter.persistDiff(conn, updated);
  const update = queries.find((q) => q.sql.startsWith('UPDATE `instansis`'));
  assert.ok(update, 'harus ada UPDATE instansis');
  assert.match(update!.sql, /`nama_instansi` = \?/);
  assert.deepEqual(update!.params, ['Lama Diubah', 0, 0, 1]);

  adapter.lastPersisted = updated;
  queries.length = 0;
  const deleted = { ...updated, instansis: [{ id: 2, nama_instansi: 'Baru' }] };
  await adapter.persistDiff(conn, deleted);
  const remove = queries.find((q) => q.sql.startsWith('DELETE FROM `instansis`'));
  assert.ok(remove, 'harus ada DELETE instansis');
  assert.deepEqual(remove!.params, [1]);
});

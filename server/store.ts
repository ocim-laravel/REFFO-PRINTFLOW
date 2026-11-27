import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { hashPassword, verifyPassword } from './auth.ts';
import { mysqlAdapter, type SyncTable } from './mysql-adapter.ts';
import {
  buildDefaultTaxSettings,
  DEFAULT_ROLL_AREA_M2,
  DEFAULT_ROLL_PER_GALON,
  DEFAULT_TINTA_GALON_ML,
  hitungTintaMlPerM2,
} from './domain.ts';
import type {
  AdvertisingSpk,
  AuditLog,
  CetakGrup,
  CetakGrupItem,
  Customer,
  CustomerCategory,
  DesignRevision,
  ExpenseCategory,
  Finishing,
  InsentifJenis,
  InsentifRate,
  InsentifRole,
  GoodsReceipt,
  Instansi,
  MaterialLog,
  MaterialOffcut,
  MaterialRoll,
  OperationalExpense,
  Order,
  OrderItem,
  OrderPayment,
  PemakaianTinta,
  PrintBatch,
  PrintMachine,
  Product,
  ProductionStatus,
  PurchaseOrder,
  PurchaseOrderItem,
  Shift,
  SpkFieldStatus,
  StokCattoff,
  Supplier,
  SupplierPayment,
  SupplyItem,
  SupplyUsage,
  TaxSettings,
  TintaWarna,
  User,
  WhatsAppGatewayConfig,
  WhatsappOutbox,
} from '../src/types.ts';

export interface StoredUser extends User {
  password: string;
}

export interface DatabaseState {
  users: StoredUser[];
  instansis: Instansi[];
  customers: Customer[];
  products: Product[];
  finishings: Finishing[];
  material_rolls: MaterialRoll[];
  material_offcuts: MaterialOffcut[];
  stok_cattoff: StokCattoff[];
  tinta_warna: TintaWarna[];
  pemakaian_tinta: PemakaianTinta[];
  cetak_grup: Omit<CetakGrup, 'operator_name' | 'machine_name' | 'items'>[];
  cetak_grup_item: Omit<CetakGrupItem, 'no_nota' | 'nama_item' | 'product_name' | 'qty_order'>[];
  machines: PrintMachine[];
  supplies: SupplyItem[];
  supply_usages: SupplyUsage[];
  print_batches: PrintBatch[];
  orders: Omit<
    Order,
    | 'customer'
    | 'admin_name'
    | 'designer_name'
    | 'sisa_tagihan'
    | 'items'
    | 'design_revisions'
    | 'advertising_spks'
    | 'payments'
  >[];
  order_items: Omit<
    OrderItem,
    | 'product_name' | 'product_category' | 'stok_pcs' | 'finishing_name' | 'ekstra_finishing' | 'ukuran_kotor' | 'rekomendasi_roll' | 'acc_admin_name'
    | 'machine_name' | 'operator_name' | 'finishing_user_name'
  >[];
  order_payments: Omit<OrderPayment, 'admin_name'>[];
  design_revisions: Omit<DesignRevision, 'admin_name'>[];
  advertising_spks: Omit<AdvertisingSpk, 'no_nota' | 'instansi' | 'nama_pelanggan' | 'deadline'>[];
  material_logs: Omit<MaterialLog, 'no_nota' | 'product_name' | 'kode_roll'>[];
  operational_expenses: OperationalExpense[];
  shifts: Shift[];
  suppliers: Supplier[];
  purchase_orders: PurchaseOrder[];
  goods_receipts: GoodsReceipt[];
  supplier_payments: SupplierPayment[];
  whatsapp_outbox: WhatsappOutbox[];
  whatsapp_gateway_config: WhatsAppGatewayConfig | null;
  tax_settings: TaxSettings | null;
  audit_logs: AuditLog[];
  insentif_rates: InsentifRate[];
  counters: Record<string, number>;
}

const DATA_DIR = path.resolve(process.cwd(), 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

export const STANDARD_ROLL_SPECS: Record<string, { lebar_m: number; panjang_m: number }> = {
  'MMT 280': { lebar_m: 3.2, panjang_m: 70.0 },
  'MMT 340': { lebar_m: 3.2, panjang_m: 70.0 },
  'MMT 440': { lebar_m: 3.2, panjang_m: 70.0 },
  Backlit: { lebar_m: 3.2, panjang_m: 70.0 },
  'Stiker 1m': { lebar_m: 1.0, panjang_m: 50.0 },
  'Stiker 1.5m': { lebar_m: 1.5, panjang_m: 50.0 },
};

export function round2(val: number): number {
  return Math.round((val + Number.EPSILON) * 100) / 100;
}

export const INSENTIF_ROLES: InsentifRole[] = ['desainer', 'operator_cetak', 'finishing'];
export const INSENTIF_JENIS: InsentifJenis[] = ['per_item', 'per_job'];

const DEFAULT_INSENTIF_RATES: Array<Pick<InsentifRate, 'role' | 'jenis' | 'nominal'>> = [
  { role: 'desainer', jenis: 'per_item', nominal: 1500 },
  { role: 'desainer', jenis: 'per_job', nominal: 5000 },
  { role: 'operator_cetak', jenis: 'per_item', nominal: 2000 },
  { role: 'operator_cetak', jenis: 'per_job', nominal: 5000 },
  { role: 'finishing', jenis: 'per_item', nominal: 1500 },
  { role: 'finishing', jenis: 'per_job', nominal: 5000 },
];

export function buildDefaultInsentifRates(): InsentifRate[] {
  return DEFAULT_INSENTIF_RATES.map((rate, index) => ({
    ...rate,
    id: index + 1,
    updated_at: null,
    updated_by: null,
  }));
}

export function buildDefaultTintaWarna(): TintaWarna[] {
  const now = new Date().toISOString();
  const konsumsi = hitungTintaMlPerM2(DEFAULT_TINTA_GALON_ML, DEFAULT_ROLL_PER_GALON, DEFAULT_ROLL_AREA_M2);
  return [
    { id: 1, kode: 'TINTA-C', warna: 'Cyan', satuan: 'ml', stok_ml: 5000, stok_minimum_ml: 1000, kapasitas_galon_ml: 5000, roll_per_galon: 6, luas_per_roll_m2: 224, konsumsi_ml_per_m2: konsumsi, aktif: true, created_at: now, updated_at: now },
    { id: 2, kode: 'TINTA-M', warna: 'Magenta', satuan: 'ml', stok_ml: 5000, stok_minimum_ml: 1000, kapasitas_galon_ml: 5000, roll_per_galon: 6, luas_per_roll_m2: 224, konsumsi_ml_per_m2: konsumsi, aktif: true, created_at: now, updated_at: now },
    { id: 3, kode: 'TINTA-Y', warna: 'Yellow', satuan: 'ml', stok_ml: 5000, stok_minimum_ml: 1000, kapasitas_galon_ml: 5000, roll_per_galon: 6, luas_per_roll_m2: 224, konsumsi_ml_per_m2: konsumsi, aktif: true, created_at: now, updated_at: now },
    { id: 4, kode: 'TINTA-K', warna: 'Black', satuan: 'ml', stok_ml: 5000, stok_minimum_ml: 1000, kapasitas_galon_ml: 5000, roll_per_galon: 6, luas_per_roll_m2: 224, konsumsi_ml_per_m2: konsumsi, aktif: true, created_at: now, updated_at: now },
  ];
}

export function buildDefaultStokCattoff(): StokCattoff[] {
  const now = new Date().toISOString();
  return [
    {
      id: 1,
      kode: 'CT-MMT280-01',
      jenis_bahan: 'MMT 280',
      lebar_m: 3.2,
      panjang_awal_m: 15,
      panjang_sisa_m: 15,
      status: 'aktif',
      created_at: now,
      updated_at: now,
    },
  ];
}

/** Konfigurasi awal gateway WA: DB mengikuti .env saat pertama kali dibuat. */
export function buildDefaultWhatsappGatewayConfig(): WhatsAppGatewayConfig {
  const webhookUrl = String(process.env.WHATSAPP_WEBHOOK_URL ?? '').trim();
  return {
    id: 1,
    webhook_url: webhookUrl.replace(/\/+$/, ''),
    webhook_token: String(process.env.WHATSAPP_WEBHOOK_TOKEN ?? '').trim(),
    app_url: String(process.env.APP_URL ?? `http://localhost:${process.env.PORT ?? 3000}`)
      .trim()
      .replace(/\/+$/, ''),
    aktif: Boolean(webhookUrl),
    updated_at: null,
    updated_by: null,
  };
}

export function priceForCategory(product: Product, category: CustomerCategory): number {
  switch (category) {
    case 'reseller':
      return product.harga_reseller;
    case 'prioritas':
      return product.harga_prioritas;
    case 'pegawai':
      return product.harga_pegawai;
    default:
      return product.harga_umum;
  }
}

export function computeUkuranKotor(
  lebar_m: number,
  tinggi_m: number,
  qty: number,
  finishing?: Finishing | null,
): { lebar: number; tinggi: number; luas: number } {
  const ekstraKiri = finishing?.ekstra_kiri_cm ?? 0;
  const ekstraKanan = finishing?.ekstra_kanan_cm ?? 0;
  const ekstraAtas = finishing?.ekstra_atas_cm ?? 0;
  const ekstraBawah = finishing?.ekstra_bawah_cm ?? 0;
  const lebar = round2(lebar_m + (ekstraKiri + ekstraKanan) / 100);
  const tinggi = round2(tinggi_m + (ekstraAtas + ekstraBawah) / 100);
  return {
    lebar,
    tinggi,
    luas: round2(lebar * tinggi * qty),
  };
}

function isoOffsetDays(days: number, hour = 9): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(hour, 15, 0, 0);
  return d.toISOString();
}

function dateOffsetDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function notaDateStr(daysOffset = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + daysOffset);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

function generateSeedPassword(): string {
  return crypto.randomBytes(12).toString('base64url');
}

let seedCredentialsWritten = false;

/**
 * Password seed tidak boleh lagi "password123". Saat database baru dibuat,
 * password acak ditulis sekali ke file lokal yang tidak ikut git agar admin
 * bisa login pertama kali lalu menggantinya lewat menu staf.
 */
function writeSeedCredentials(rows: Array<{ email: string; role: string; password: string }>): void {
  if (seedCredentialsWritten || rows.length === 0) return;
  seedCredentialsWritten = true;
  const file = path.join(DATA_DIR, 'initial-credentials.txt');
  const body = [
    '# Kredensial awal Reffo PrintFlow (HAPUS setelah semua password diganti)',
    `# Dibuat: ${new Date().toISOString()}`,
    ...rows.map((r) => `${r.role}\t${r.email}\t${r.password}`),
    '',
  ].join('\n');
  fs.writeFileSync(file, body, { encoding: 'utf-8', mode: 0o600 });
  console.warn(`[security] Password seed acak ditulis ke ${file}. Ganti password lalu hapus file ini.`);
}

function writePasswordResetReport(rows: Array<{ email: string; password: string }>): void {
  if (rows.length === 0) return;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(DATA_DIR, `credentials-reset-${stamp}.txt`);
  const body = [
    '# Password default lama terdeteksi dan sudah direset otomatis.',
    '# Simpan file ini sementara, login, ganti password, lalu hapus file.',
    ...rows.map((r) => `${r.email}\t${r.password}`),
    '',
  ].join('\n');
  fs.writeFileSync(file, body, { encoding: 'utf-8', mode: 0o600 });
  console.warn(`[security] ${rows.length} akun memakai password default. Password baru ditulis ke ${file}.`);
}

function backupDatabaseFile(reason: string): string | null {
  if (!fs.existsSync(DB_FILE)) return null;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = path.join(DATA_DIR, 'backups');
  fs.mkdirSync(backupDir, { recursive: true });
  const target = path.join(backupDir, `db-${reason}-${stamp}.json`);
  fs.copyFileSync(DB_FILE, target);
  console.warn(`[backup] db.json disalin ke ${target}`);
  return target;
}

function createInitialSeed(writeCredentials = true): DatabaseState {
  const credentials = [
    { id: 1, name: 'Rina', email: 'admin@reffoprint.id', role: 'admin' as const },
    { id: 2, name: 'Budi', email: 'desainer@reffoprint.id', role: 'desainer' as const },
    { id: 3, name: 'Agus', email: 'operator@reffoprint.id', role: 'operator_cetak' as const },
    { id: 4, name: 'Dedi', email: 'finishing@reffoprint.id', role: 'finishing' as const },
    { id: 5, name: 'Eko', email: 'advertising@reffoprint.id', role: 'advertising' as const },
    { id: 6, name: 'Pak Hendra', email: 'owner@reffoprint.id', role: 'owner' as const },
  ].map((row) => ({ ...row, password: generateSeedPassword() }));
  if (writeCredentials) writeSeedCredentials(credentials);
  const users: StoredUser[] = credentials.map((row) => ({
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    password: hashPassword(row.password),
    active: true,
  }));

  const instansis: Instansi[] = [
    { id: 1, nama_instansi: 'Perorangan' },
    { id: 2, nama_instansi: 'Dinas Kebudayaan & Pariwisata' },
    { id: 3, nama_instansi: 'PT Graha Nusantara Mandiri' },
    { id: 4, nama_instansi: 'CV Kreasindo Digital Agency' },
    { id: 5, nama_instansi: 'Universitas Merdeka Nusantara' },
  ];

  const customers: Customer[] = [
    {
      id: 1,
      instansi_id: 2,
      instansi: 'Dinas Kebudayaan & Pariwisata',
      nama_pelanggan: 'Ibu Kartika Sari',
      no_wa: '081228991100',
      kategori: 'prioritas',
      alamat: 'Jl. Jenderal Sudirman No. 45',
    },
    {
      id: 2,
      instansi_id: 3,
      instansi: 'PT Graha Nusantara Mandiri',
      nama_pelanggan: 'Bpk. Pratama Wijaya',
      no_wa: '081345678901',
      kategori: 'prioritas',
      alamat: 'Kawasan Bisnis Sentral Blok B2',
    },
    {
      id: 3,
      instansi_id: 4,
      instansi: 'CV Kreasindo Digital Agency',
      nama_pelanggan: 'Mas Fajar Ramadhan',
      no_wa: '085712349876',
      kategori: 'reseller',
      alamat: 'Jl. Diponegoro No. 18',
    },
    {
      id: 4,
      instansi_id: 5,
      instansi: 'Universitas Merdeka Nusantara',
      nama_pelanggan: 'Panitia BEM / Saudara Raka',
      no_wa: '082198765432',
      kategori: 'prioritas',
      alamat: 'Kampus Terpadu Gedung C',
    },
    {
      id: 5,
      instansi_id: 1,
      instansi: 'Perorangan',
      nama_pelanggan: 'Bu Siti Rahayu',
      no_wa: '087811223344',
      kategori: 'umum',
      alamat: 'Perum Griya Indah Blok A7',
    },
  ];

  const products: Product[] = [
    {
      id: 1,
      nama_produk: 'MMT 280',
      kategori_produk: 'meteran',
      harga_umum: 30000,
      harga_reseller: 27000,
      harga_prioritas: 25000,
      harga_pegawai: 22000,
      harga_modal: 18000,
      stok_pcs: null,
    },
    {
      id: 2,
      nama_produk: 'MMT 340',
      kategori_produk: 'meteran',
      harga_umum: 35000,
      harga_reseller: 31000,
      harga_prioritas: 29000,
      harga_pegawai: 25000,
      harga_modal: 21000,
      stok_pcs: null,
    },
    {
      id: 3,
      nama_produk: 'MMT 440',
      kategori_produk: 'meteran',
      harga_umum: 45000,
      harga_reseller: 40000,
      harga_prioritas: 37000,
      harga_pegawai: 32000,
      harga_modal: 27000,
      stok_pcs: null,
    },
    {
      id: 4,
      nama_produk: 'Backlit',
      kategori_produk: 'meteran',
      harga_umum: 60000,
      harga_reseller: 54000,
      harga_prioritas: 50000,
      harga_pegawai: 45000,
      harga_modal: 38000,
      stok_pcs: null,
    },
    {
      id: 5,
      nama_produk: 'Stiker Meteran',
      kategori_produk: 'meteran',
      harga_umum: 50000,
      harga_reseller: 45000,
      harga_prioritas: 42000,
      harga_pegawai: 38000,
      harga_modal: 32000,
      stok_pcs: null,
    },
    {
      id: 6,
      nama_produk: 'X-Banner',
      kategori_produk: 'satuan',
      harga_umum: 85000,
      harga_reseller: 75000,
      harga_prioritas: 70000,
      harga_pegawai: 65000,
      harga_modal: 55000,
      stok_pcs: 24,
    },
    {
      id: 7,
      nama_produk: 'Roll Banner',
      kategori_produk: 'satuan',
      harga_umum: 150000,
      harga_reseller: 135000,
      harga_prioritas: 125000,
      harga_pegawai: 115000,
      harga_modal: 95000,
      stok_pcs: 18,
    },
    {
      id: 8,
      nama_produk: 'Poster',
      kategori_produk: 'satuan',
      harga_umum: 15000,
      harga_reseller: 13000,
      harga_prioritas: 12000,
      harga_pegawai: 10000,
      harga_modal: 8000,
      stok_pcs: 45,
    },
    {
      id: 9,
      nama_produk: 'Stiker A3',
      kategori_produk: 'satuan',
      harga_umum: 20000,
      harga_reseller: 17500,
      harga_prioritas: 16000,
      harga_pegawai: 14000,
      harga_modal: 11000,
      stok_pcs: 60,
    },
    {
      id: 10,
      nama_produk: 'A-Board',
      kategori_produk: 'satuan',
      harga_umum: 250000,
      harga_reseller: 225000,
      harga_prioritas: 210000,
      harga_pegawai: 195000,
      harga_modal: 170000,
      stok_pcs: 8,
    },
    {
      id: 11,
      nama_produk: 'Kartu Nama A3+',
      kategori_produk: 'satuan',
      harga_umum: 90000,
      harga_reseller: 80000,
      harga_prioritas: 75000,
      harga_pegawai: 65000,
      harga_modal: 52000,
      stok_pcs: 120,
      mesin_default_id: 3,
      satuan_hitung: 'klik',
      klik_per_lembar: 2,
      ukuran_lembar: 'A3+ 329 × 483 mm (bolak-balik)',
    },
    {
      id: 12,
      nama_produk: 'Brosur A3+',
      kategori_produk: 'satuan',
      harga_umum: 18000,
      harga_reseller: 16000,
      harga_prioritas: 14500,
      harga_pegawai: 13000,
      harga_modal: 9500,
      stok_pcs: 200,
      mesin_default_id: 3,
      satuan_hitung: 'klik',
      klik_per_lembar: 2,
      ukuran_lembar: 'A3+ 329 × 483 mm (bolak-balik)',
    },
    {
      id: 13,
      nama_produk: 'Stiker A3+ UV',
      kategori_produk: 'satuan',
      harga_umum: 25000,
      harga_reseller: 22000,
      harga_prioritas: 20000,
      harga_pegawai: 18000,
      harga_modal: 14000,
      stok_pcs: 150,
      mesin_default_id: 2,
      satuan_hitung: 'klik',
      klik_per_lembar: 1,
      ukuran_lembar: 'A3+ 329 × 483 mm',
    },
  ];

  const finishings: Finishing[] = [
    { id: 1, nama_finishing: 'Siming', ekstra_kiri_cm: 2.5, ekstra_kanan_cm: 2.5, ekstra_atas_cm: 2.5, ekstra_bawah_cm: 2.5 },
    { id: 2, nama_finishing: 'Siming Keling', ekstra_kiri_cm: 2.5, ekstra_kanan_cm: 2.5, ekstra_atas_cm: 2.5, ekstra_bawah_cm: 2.5 },
    { id: 3, nama_finishing: 'Kolong AB Samping Potong Press', ekstra_kiri_cm: 0, ekstra_kanan_cm: 0, ekstra_atas_cm: 7, ekstra_bawah_cm: 7 },
    { id: 4, nama_finishing: 'Kolong AB Samping Siming', ekstra_kiri_cm: 2.5, ekstra_kanan_cm: 2.5, ekstra_atas_cm: 7, ekstra_bawah_cm: 7 },
    { id: 5, nama_finishing: 'Kolong KK AB Siming', ekstra_kiri_cm: 7, ekstra_kanan_cm: 7, ekstra_atas_cm: 2.5, ekstra_bawah_cm: 2.5 },
    { id: 6, nama_finishing: 'Kolong KK AB Samping Potong Press', ekstra_kiri_cm: 7, ekstra_kanan_cm: 7, ekstra_atas_cm: 0, ekstra_bawah_cm: 0 },
    { id: 7, nama_finishing: 'Kolong Baliho', ekstra_kiri_cm: 7.5, ekstra_kanan_cm: 7.5, ekstra_atas_cm: 7.5, ekstra_bawah_cm: 7.5 },
  ];

  const material_rolls: MaterialRoll[] = [
    { id: 1, kode_roll: 'MMT280-R01', jenis_bahan: 'MMT 280', lebar_m: 3.2, panjang_awal_m: 70, panjang_sisa_m: 54.4, status: 'aktif' },
    { id: 2, kode_roll: 'MMT280-R02', jenis_bahan: 'MMT 280', lebar_m: 3.2, panjang_awal_m: 70, panjang_sisa_m: 70, status: 'aktif' },
    { id: 3, kode_roll: 'MMT340-R01', jenis_bahan: 'MMT 340', lebar_m: 3.2, panjang_awal_m: 70, panjang_sisa_m: 61.5, status: 'aktif' },
    { id: 4, kode_roll: 'MMT440-R01', jenis_bahan: 'MMT 440', lebar_m: 3.2, panjang_awal_m: 70, panjang_sisa_m: 58.0, status: 'aktif' },
    { id: 5, kode_roll: 'BACKLIT-R01', jenis_bahan: 'Backlit', lebar_m: 3.2, panjang_awal_m: 70, panjang_sisa_m: 64.0, status: 'aktif' },
    { id: 6, kode_roll: 'STIKER1M-R01', jenis_bahan: 'Stiker 1m', lebar_m: 1.0, panjang_awal_m: 50, panjang_sisa_m: 41.2, status: 'aktif' },
    { id: 7, kode_roll: 'STIKER15M-R01', jenis_bahan: 'Stiker 1.5m', lebar_m: 1.5, panjang_awal_m: 50, panjang_sisa_m: 44.5, status: 'aktif' },
  ];

  const material_offcuts: MaterialOffcut[] = [
    {
      id: 1,
      material_roll_id: 1,
      kode_roll: 'MMT280-R01',
      jenis_bahan: 'MMT 280',
      lebar_m: 1.15,
      panjang_m: 6.1,
      luas_m2: 7.02,
      status: 'tersedia',
      created_at: isoOffsetDays(-2, 11),
    },
    {
      id: 2,
      material_roll_id: 4,
      kode_roll: 'MMT440-R01',
      jenis_bahan: 'MMT 440',
      lebar_m: 0.95,
      panjang_m: 4.1,
      luas_m2: 3.9,
      status: 'tersedia',
      created_at: isoOffsetDays(-1, 14),
    },
  ];

  const machines: PrintMachine[] = [
    {
      id: 1,
      kode_mesin: 'LF-01',
      nama_mesin: 'Large Format Solvent/Eco-Solvent',
      jenis: 'large_format',
      lebar_max_m: 3.2,
      konsumsi_tinta_ml_per_m2: 12,
      aktif: true,
      keterangan: 'MMT, Backlit, dan Stiker Roll',
      created_at: isoOffsetDays(-60, 8),
      updated_at: isoOffsetDays(-60, 8),
    },
    {
      id: 2,
      kode_mesin: 'UV-01',
      nama_mesin: 'UV Roll / Flatbed',
      jenis: 'uv',
      lebar_max_m: 3.2,
      konsumsi_tinta_ml_per_m2: 16,
      aktif: true,
      keterangan: 'Akrilik, PVC, Stiker UV',
      created_at: isoOffsetDays(-60, 8),
      updated_at: isoOffsetDays(-60, 8),
    },
    {
      id: 3,
      kode_mesin: 'A3P-01',
      nama_mesin: 'Digital Press A3+',
      jenis: 'digital_a3p',
      lebar_max_m: 0.483,
      konsumsi_tinta_ml_per_m2: 9,
      aktif: true,
      keterangan: 'Art Paper, Art Carton, Stiker A3+, Brosur, Kartu Nama (hitung klik)',
      created_at: isoOffsetDays(-60, 8),
      updated_at: isoOffsetDays(-60, 8),
    },
    {
      id: 4,
      kode_mesin: 'CUT-01',
      nama_mesin: 'Cutting Sticker & Laser',
      jenis: 'cutting',
      lebar_max_m: 1.2,
      konsumsi_tinta_ml_per_m2: 0,
      aktif: true,
      keterangan: 'Kiss-cut, die-cut, dan laser acrylic',
      created_at: isoOffsetDays(-60, 8),
      updated_at: isoOffsetDays(-60, 8),
    },
  ];

  const supplies: SupplyItem[] = [
    {
      id: 1,
      kode: 'TINTA-CMYK-LF',
      nama: 'Tinta Eco Solvent C/M/Y/K',
      kategori: 'tinta',
      satuan: 'ml',
      stok: 18000,
      stok_minimum: 3000,
      harga_satuan: 0.35,
      konsumsi_per_m2: 12,
      aktif: true,
      created_at: isoOffsetDays(-60, 8),
      updated_at: isoOffsetDays(-2, 8),
    },
    {
      id: 2,
      kode: 'TINTA-UV',
      nama: 'Tinta UV C/M/Y/K/White',
      kategori: 'tinta',
      satuan: 'ml',
      stok: 9500,
      stok_minimum: 2000,
      harga_satuan: 0.8,
      konsumsi_per_m2: 16,
      aktif: true,
      created_at: isoOffsetDays(-60, 8),
      updated_at: isoOffsetDays(-2, 8),
    },
    {
      id: 3,
      kode: 'TINTA-A3P',
      nama: 'Toner Digital Press A3+',
      kategori: 'tinta',
      satuan: 'ml',
      stok: 4200,
      stok_minimum: 1200,
      harga_satuan: 0.5,
      konsumsi_per_m2: 9,
      aktif: true,
      created_at: isoOffsetDays(-60, 8),
      updated_at: isoOffsetDays(-2, 8),
    },
    {
      id: 4,
      kode: 'LAMINASI-DOFF',
      nama: 'Plastik Laminasi Doff',
      kategori: 'bahan_pembantu',
      satuan: 'meter',
      stok: 120,
      stok_minimum: 30,
      harga_satuan: 6500,
      konsumsi_per_m2: null,
      aktif: true,
      created_at: isoOffsetDays(-60, 8),
      updated_at: isoOffsetDays(-2, 8),
    },
    {
      id: 5,
      kode: 'MATA-AYAM',
      nama: 'Mata Ayam / Keling',
      kategori: 'bahan_pembantu',
      satuan: 'pcs',
      stok: 850,
      stok_minimum: 200,
      harga_satuan: 350,
      konsumsi_per_m2: null,
      aktif: true,
      created_at: isoOffsetDays(-60, 8),
      updated_at: isoOffsetDays(-2, 8),
    },
    {
      id: 6,
      kode: 'SELONGSONG',
      nama: 'Selongsong / Bambu Roll Banner',
      kategori: 'bahan_pembantu',
      satuan: 'pcs',
      stok: 32,
      stok_minimum: 10,
      harga_satuan: 45000,
      konsumsi_per_m2: null,
      aktif: true,
      created_at: isoOffsetDays(-60, 8),
      updated_at: isoOffsetDays(-2, 8),
    },
    {
      id: 7,
      kode: 'DAMPER-LF',
      nama: 'Damper Printhead Large Format',
      kategori: 'suku_cadang',
      satuan: 'pcs',
      stok: 6,
      stok_minimum: 4,
      harga_satuan: 85000,
      konsumsi_per_m2: null,
      aktif: true,
      created_at: isoOffsetDays(-60, 8),
      updated_at: isoOffsetDays(-2, 8),
    },
  ];

  const previewSpanduk = '/src/assets/images/preview_spanduk_event_1795506340738.jpg';
  const previewBackdrop = '/src/assets/images/preview_backdrop_seminar_1795506348622.jpg';

  const orders: DatabaseState['orders'] = [
    // Order 1: Waiting for Admin Design Review (ACC / Revisi)
    {
      id: 1,
      no_nota: `INV-${notaDateStr(0)}-0001`,
      customer_id: 1,
      user_id: 1,
      designer_id: 2,
      total_tagihan: 675000,
      jumlah_dp: 350000,
      status_bayar: 'dp',
      status_desain: 'file_mentah',
      catatan_desain: 'Tema Festival Komunitas Yogyakarta, warna biru cobalt & putih, sertakan logo dinas.',
      lampiran_briefing: null,
      file_master_arsip: null,
      waktu_terima_desain: isoOffsetDays(0, 8),
      waktu_selesai_desain: null,
      tanda_tangan_desainer: null,
      tanda_tangan_admin: null,
      bukti_pelunasan: null,
      foto_serah_terima: null,
      tanda_tangan_pengambil: null,
      nama_pengambil: null,
      no_wa_pengambil: null,
      kurir_nama: null,
      resi_pengiriman: null,
      waktu_serah_terima: null,
      catatan_pengecualian: null,
      deadline: isoOffsetDays(1, 17),
      created_at: isoOffsetDays(0, 8),
      updated_at: isoOffsetDays(0, 10),
    },
    // Order 2: Antrean Cetak (Operator Cetak) + SPK Advertising
    {
      id: 2,
      no_nota: `INV-${notaDateStr(-1)}-0002`,
      customer_id: 2,
      user_id: 1,
      designer_id: 2,
      total_tagihan: 1380000,
      jumlah_dp: 1380000,
      status_bayar: 'lunas',
      status_desain: 'siap_cetak_tiff',
      catatan_desain: 'Backdrop Seminar Corporate Governance + Standing X-Banner arah aula.',
      lampiran_briefing: null,
      file_master_arsip: 'MASTER-INV-0002-FINAL.cdr',
      waktu_terima_desain: isoOffsetDays(-1, 9),
      waktu_selesai_desain: isoOffsetDays(-1, 13),
      tanda_tangan_desainer: 'Budi',
      tanda_tangan_admin: 'Rina',
      bukti_pelunasan: null,
      foto_serah_terima: null,
      tanda_tangan_pengambil: null,
      nama_pengambil: null,
      no_wa_pengambil: null,
      kurir_nama: null,
      resi_pengiriman: null,
      waktu_serah_terima: null,
      catatan_pengecualian: null,
      deadline: isoOffsetDays(1, 12),
      created_at: isoOffsetDays(-1, 8),
      updated_at: isoOffsetDays(-1, 13),
    },
    // Order 3: Antrean Finishing (Finishing Division)
    {
      id: 3,
      no_nota: `INV-${notaDateStr(-1)}-0003`,
      customer_id: 3,
      user_id: 1,
      designer_id: 2,
      total_tagihan: 486000,
      jumlah_dp: 250000,
      status_bayar: 'dp',
      status_desain: 'siap_cetak_tiff',
      catatan_desain: 'Spanduk promosi ritel reseller, pastikan mata ayam tiap 50cm.',
      lampiran_briefing: null,
      file_master_arsip: 'MASTER-INV-0003-FINAL.ai',
      waktu_terima_desain: isoOffsetDays(-1, 10),
      waktu_selesai_desain: isoOffsetDays(-1, 14),
      tanda_tangan_desainer: 'Budi',
      tanda_tangan_admin: 'Rina',
      bukti_pelunasan: null,
      foto_serah_terima: null,
      tanda_tangan_pengambil: null,
      nama_pengambil: null,
      no_wa_pengambil: null,
      kurir_nama: null,
      resi_pengiriman: null,
      waktu_serah_terima: null,
      catatan_pengecualian: null,
      deadline: isoOffsetDays(2, 16),
      created_at: isoOffsetDays(-1, 10),
      updated_at: isoOffsetDays(0, 9),
    },
    // Order 4: Siap Diambil (waiting Pelunasan -> Serah Terima)
    {
      id: 4,
      no_nota: `INV-${notaDateStr(-2)}-0004`,
      customer_id: 4,
      user_id: 1,
      designer_id: 2,
      total_tagihan: 890000,
      jumlah_dp: 400000,
      status_bayar: 'dp',
      status_desain: 'siap_cetak_tiff',
      catatan_desain: 'Spanduk Orientasi Mahasiswa Baru & Poster A3.',
      lampiran_briefing: null,
      file_master_arsip: 'MASTER-INV-0004.pdf',
      waktu_terima_desain: isoOffsetDays(-2, 9),
      waktu_selesai_desain: isoOffsetDays(-2, 12),
      tanda_tangan_desainer: 'Budi',
      tanda_tangan_admin: 'Rina',
      bukti_pelunasan: null,
      foto_serah_terima: null,
      tanda_tangan_pengambil: null,
      nama_pengambil: null,
      no_wa_pengambil: null,
      kurir_nama: null,
      resi_pengiriman: null,
      waktu_serah_terima: null,
      catatan_pengecualian: null,
      deadline: isoOffsetDays(0, 17),
      created_at: isoOffsetDays(-2, 9),
      updated_at: isoOffsetDays(-1, 16),
    },
    // Order 5: Menunggu Desain (Baru masuk ke antrean Desainer)
    {
      id: 5,
      no_nota: `INV-${notaDateStr(0)}-0005`,
      customer_id: 5,
      user_id: 1,
      designer_id: null,
      total_tagihan: 330000,
      jumlah_dp: 0,
      status_bayar: 'belum_lunas',
      status_desain: 'belum_ada_file',
      catatan_desain: 'Banner Warung Kuliner Bu Siti: menu bakso, soto, es teh. Foto menu menyusul via WA.',
      lampiran_briefing: null,
      file_master_arsip: null,
      waktu_terima_desain: null,
      waktu_selesai_desain: null,
      tanda_tangan_desainer: null,
      tanda_tangan_admin: null,
      bukti_pelunasan: null,
      foto_serah_terima: null,
      tanda_tangan_pengambil: null,
      nama_pengambil: null,
      no_wa_pengambil: null,
      kurir_nama: null,
      resi_pengiriman: null,
      waktu_serah_terima: null,
      catatan_pengecualian: null,
      deadline: isoOffsetDays(2, 15),
      created_at: isoOffsetDays(0, 11),
      updated_at: isoOffsetDays(0, 11),
    },
    // Order 6: Selesai (Closed & Handed Over, contributes to Omzet & Profit/Loss)
    {
      id: 6,
      no_nota: `INV-${notaDateStr(-4)}-0006`,
      customer_id: 2,
      user_id: 1,
      designer_id: 2,
      total_tagihan: 1500000,
      jumlah_dp: 1500000,
      status_bayar: 'lunas',
      status_desain: 'siap_cetak_tiff',
      catatan_desain: 'Neonbox Backlit Lobby & Stiker Kaca Kantor.',
      lampiran_briefing: null,
      file_master_arsip: 'MASTER-INV-0006.tif',
      waktu_terima_desain: isoOffsetDays(-4, 9),
      waktu_selesai_desain: isoOffsetDays(-4, 13),
      tanda_tangan_desainer: 'Budi',
      tanda_tangan_admin: 'Rina',
      bukti_pelunasan: null,
      foto_serah_terima: null,
      tanda_tangan_pengambil: null,
      nama_pengambil: 'Bagus (Kurir PT Graha)',
      no_wa_pengambil: '081345670000',
      kurir_nama: 'Kurir PT Graha',
      resi_pengiriman: null,
      waktu_serah_terima: isoOffsetDays(-3, 16),
      catatan_pengecualian: null,
      deadline: isoOffsetDays(-3, 17),
      created_at: isoOffsetDays(-4, 9),
      updated_at: isoOffsetDays(-3, 16),
    },
  ];

  const order_items: DatabaseState['order_items'] = [
    // Order 1 items
    {
      id: 1,
      order_id: 1,
      nama_item: 'Spanduk Utama Festival',
      product_id: 1, // MMT 280
      finishing_id: 2, // Siming Keling
      lebar_m: 4.5,
      tinggi_m: 2.0,
      qty: 3,
      luas_tagihan_m2: 27.0,
      harga_satuan_dipakai: 25000,
      subtotal: 675000,
      status_produksi: 'menunggu_acc',
      acc_admin_id: null,
      waktu_acc: null,
      file_preview_acc: previewSpanduk,
      file_cetak_tiff: null,
      file_master_arsip: null,
      created_at: isoOffsetDays(0, 8),
      updated_at: isoOffsetDays(0, 10),
    },
    // Order 2 items
    {
      id: 2,
      order_id: 2,
      nama_item: 'Backdrop Panggung Utama',
      product_id: 3, // MMT 440
      finishing_id: 7, // Kolong Baliho
      lebar_m: 6.0,
      tinggi_m: 3.0,
      qty: 1,
      luas_tagihan_m2: 18.0,
      harga_satuan_dipakai: 37000,
      subtotal: 666000,
      status_produksi: 'antrean_cetak',
      acc_admin_id: 1,
      waktu_acc: isoOffsetDays(-1, 12),
      file_preview_acc: previewBackdrop,
      file_cetak_tiff: 'backdrop-panggung-6x3.tif',
      file_master_arsip: 'MASTER-INV-0002-FINAL.cdr',
      created_at: isoOffsetDays(-1, 8),
      updated_at: isoOffsetDays(-1, 13),
    },
    {
      id: 3,
      order_id: 2,
      nama_item: 'Stiker Signboard Arah',
      product_id: 5, // Stiker Meteran
      finishing_id: null,
      lebar_m: 0.85,
      tinggi_m: 1.5,
      qty: 4,
      luas_tagihan_m2: 5.1,
      harga_satuan_dipakai: 42000,
      subtotal: 214200,
      status_produksi: 'antrean_cetak',
      acc_admin_id: 1,
      waktu_acc: isoOffsetDays(-1, 12),
      file_preview_acc: previewBackdrop,
      file_cetak_tiff: 'stiker-signboard.tif',
      file_master_arsip: 'MASTER-INV-0002-FINAL.cdr',
      created_at: isoOffsetDays(-1, 8),
      updated_at: isoOffsetDays(-1, 13),
    },
    {
      id: 4,
      order_id: 2,
      nama_item: 'Roll Banner Registrasi',
      product_id: 7, // Roll Banner
      finishing_id: null,
      lebar_m: null,
      tinggi_m: null,
      qty: 4,
      luas_tagihan_m2: null,
      harga_satuan_dipakai: 125000,
      subtotal: 500000,
      status_produksi: 'antrean_cetak',
      acc_admin_id: 1,
      waktu_acc: isoOffsetDays(-1, 12),
      file_preview_acc: previewBackdrop,
      file_cetak_tiff: 'roll-banner-reg.tif',
      file_master_arsip: 'MASTER-INV-0002-FINAL.cdr',
      created_at: isoOffsetDays(-1, 8),
      updated_at: isoOffsetDays(-1, 13),
    },
    // Order 3 items (in Finishing)
    {
      id: 5,
      order_id: 3,
      nama_item: 'Spanduk Promo Ritel',
      product_id: 1, // MMT 280
      finishing_id: 2, // Siming Keling
      lebar_m: 3.0,
      tinggi_m: 1.5,
      qty: 4,
      luas_tagihan_m2: 18.0,
      harga_satuan_dipakai: 27000,
      subtotal: 486000,
      status_produksi: 'antrean_finishing',
      acc_admin_id: 1,
      waktu_acc: isoOffsetDays(-1, 13),
      file_preview_acc: previewSpanduk,
      file_cetak_tiff: 'spanduk-ritel-3x15.tif',
      file_master_arsip: 'MASTER-INV-0003-FINAL.ai',
      created_at: isoOffsetDays(-1, 10),
      updated_at: isoOffsetDays(0, 9),
    },
    // Order 4 items (Siap Diambil)
    {
      id: 6,
      order_id: 4,
      nama_item: 'Spanduk PKKMB Fakultas',
      product_id: 2, // MMT 340
      finishing_id: 4, // Kolong AB Samping Siming
      lebar_m: 5.0,
      tinggi_m: 2.0,
      qty: 2,
      luas_tagihan_m2: 20.0,
      harga_satuan_dipakai: 29000,
      subtotal: 580000,
      status_produksi: 'siap_diambil',
      acc_admin_id: 1,
      waktu_acc: isoOffsetDays(-2, 11),
      file_preview_acc: previewSpanduk,
      file_cetak_tiff: 'pkkmb-5x2.tif',
      file_master_arsip: 'MASTER-INV-0004.pdf',
      created_at: isoOffsetDays(-2, 9),
      updated_at: isoOffsetDays(-1, 15),
    },
    {
      id: 7,
      order_id: 4,
      nama_item: 'Poster Jadwal Acara',
      product_id: 8, // Poster
      finishing_id: null,
      lebar_m: null,
      tinggi_m: null,
      qty: 25,
      luas_tagihan_m2: null,
      harga_satuan_dipakai: 12000,
      subtotal: 300000,
      status_produksi: 'siap_diambil',
      acc_admin_id: 1,
      waktu_acc: isoOffsetDays(-2, 11),
      file_preview_acc: previewSpanduk,
      file_cetak_tiff: 'poster-acara.tif',
      file_master_arsip: 'MASTER-INV-0004.pdf',
      created_at: isoOffsetDays(-2, 9),
      updated_at: isoOffsetDays(-1, 16),
    },
    // Order 5 items (Menunggu Desain)
    {
      id: 8,
      order_id: 5,
      nama_item: 'Banner Menu Warung',
      product_id: 1, // MMT 280
      finishing_id: 1, // Siming
      lebar_m: 2.5,
      tinggi_m: 1.2,
      qty: 2,
      luas_tagihan_m2: 6.0,
      harga_satuan_dipakai: 30000,
      subtotal: 180000,
      status_produksi: 'menunggu_desain',
      acc_admin_id: null,
      waktu_acc: null,
      file_preview_acc: null,
      file_cetak_tiff: null,
      file_master_arsip: null,
      created_at: isoOffsetDays(0, 11),
      updated_at: isoOffsetDays(0, 11),
    },
    {
      id: 9,
      order_id: 5,
      nama_item: 'X-Banner Promo Minuman',
      product_id: 6, // X-Banner
      finishing_id: null,
      lebar_m: null,
      tinggi_m: null,
      qty: 2,
      luas_tagihan_m2: null,
      harga_satuan_dipakai: 75000,
      subtotal: 150000,
      status_produksi: 'menunggu_desain',
      acc_admin_id: null,
      waktu_acc: null,
      file_preview_acc: null,
      file_cetak_tiff: null,
      file_master_arsip: null,
      created_at: isoOffsetDays(0, 11),
      updated_at: isoOffsetDays(0, 11),
    },
    // Order 6 items (Selesai)
    {
      id: 10,
      order_id: 6,
      nama_item: 'Neonbox Backlit Lobby',
      product_id: 4, // Backlit
      finishing_id: 1, // Siming
      lebar_m: 3.0,
      tinggi_m: 2.0,
      qty: 3,
      luas_tagihan_m2: 18.0,
      harga_satuan_dipakai: 50000,
      subtotal: 900000,
      status_produksi: 'selesai',
      acc_admin_id: 1,
      waktu_acc: isoOffsetDays(-4, 12),
      file_preview_acc: previewBackdrop,
      file_cetak_tiff: 'backlit-lobby.tif',
      file_master_arsip: 'MASTER-INV-0006.tif',
      created_at: isoOffsetDays(-4, 9),
      updated_at: isoOffsetDays(-3, 16),
    },
    {
      id: 11,
      order_id: 6,
      nama_item: 'Stiker Kaca Sandblast',
      product_id: 5, // Stiker Meteran
      finishing_id: null,
      lebar_m: 1.2,
      tinggi_m: 2.5,
      qty: 4,
      luas_tagihan_m2: 12.0,
      harga_satuan_dipakai: 42000,
      subtotal: 504000,
      status_produksi: 'selesai',
      acc_admin_id: 1,
      waktu_acc: isoOffsetDays(-4, 12),
      file_preview_acc: previewBackdrop,
      file_cetak_tiff: 'stiker-kaca.tif',
      file_master_arsip: 'MASTER-INV-0006.tif',
      created_at: isoOffsetDays(-4, 9),
      updated_at: isoOffsetDays(-3, 16),
    },
  ];

  // Fix order 2 total_tagihan to exact sum (666000 + 214200 + 500000 = 1380200), order 4 (580000+300000 = 880000), order 6 (900000+504000 = 1404000)
  orders[1].total_tagihan = 1380200;
  orders[1].jumlah_dp = 1380200;
  orders[3].total_tagihan = 880000;
  orders[5].total_tagihan = 1404000;
  orders[5].jumlah_dp = 1404000;

  const order_payments: DatabaseState['order_payments'] = [
    {
      id: 1,
      order_id: 1,
      tanggal: isoOffsetDays(0, 8),
      nominal: 350000,
      metode: 'Transfer',
      keterangan: 'DP awal pembuatan nota',
      bukti_bayar: null,
      admin_id: 1,
      created_at: isoOffsetDays(0, 8),
    },
    {
      id: 2,
      order_id: 2,
      tanggal: isoOffsetDays(-1, 8),
      nominal: 1380200,
      metode: 'Transfer',
      keterangan: 'Pelunasan langsung di muka',
      bukti_bayar: null,
      admin_id: 1,
      created_at: isoOffsetDays(-1, 8),
    },
    {
      id: 3,
      order_id: 3,
      tanggal: isoOffsetDays(-1, 10),
      nominal: 250000,
      metode: 'QRIS',
      keterangan: 'DP awal',
      bukti_bayar: null,
      admin_id: 1,
      created_at: isoOffsetDays(-1, 10),
    },
    {
      id: 4,
      order_id: 4,
      tanggal: isoOffsetDays(-2, 9),
      nominal: 400000,
      metode: 'Tunai',
      keterangan: 'DP panitia BEM',
      bukti_bayar: null,
      admin_id: 1,
      created_at: isoOffsetDays(-2, 9),
    },
    {
      id: 5,
      order_id: 6,
      tanggal: isoOffsetDays(-4, 9),
      nominal: 700000,
      metode: 'Transfer',
      keterangan: 'DP Termin 1',
      bukti_bayar: null,
      admin_id: 1,
      created_at: isoOffsetDays(-4, 9),
    },
    {
      id: 6,
      order_id: 6,
      tanggal: isoOffsetDays(-3, 15),
      nominal: 704000,
      metode: 'Transfer',
      keterangan: 'Pelunasan Termin 2 sebelum serah terima',
      bukti_bayar: null,
      admin_id: 1,
      created_at: isoOffsetDays(-3, 15),
    },
  ];

  const design_revisions: DatabaseState['design_revisions'] = [
    {
      id: 1,
      order_id: 1,
      order_item_id: null,
      revisi_ke: 1,
      catatan_revisi: 'Upload preview awal oleh Desainer',
      file_preview: previewSpanduk,
      admin_id: null,
      status_revisi: 'selesai',
      created_at: isoOffsetDays(0, 10),
    },
    {
      id: 2,
      order_id: 2,
      order_item_id: null,
      revisi_ke: 1,
      catatan_revisi: 'Perbesar logo sponsor di bagian bawah agar terbaca dari jauh.',
      file_preview: previewBackdrop,
      admin_id: 1,
      status_revisi: 'selesai',
      created_at: isoOffsetDays(-1, 11),
    },
  ];

  const advertising_spks: DatabaseState['advertising_spks'] = [
    {
      id: 1,
      order_id: 2,
      jenis_pekerjaan: 'Pemasangan Rangka Backdrop & Rigging Panggung',
      ukuran_konstruksi: '6m x 3m Besi Hollow 4x4',
      lokasi_pasang: 'Ballroom Lt. 3 Hotel Mulia Sentral',
      catatan_teknis: 'Akses loading dock dibuka pukul 21.00 WIB, wajib helm proyek.',
      status_lapangan: 'perakitan',
      created_at: isoOffsetDays(-1, 8),
      updated_at: isoOffsetDays(0, 9),
    },
    {
      id: 2,
      order_id: 6,
      jenis_pekerjaan: 'Instalasi Neonbox Backlit & Stiker Kaca',
      ukuran_konstruksi: '3m x 2m Frame Aluminium + LED Modul',
      lokasi_pasang: 'Lobby Utama PT Graha Nusantara Mandiri',
      catatan_teknis: 'Gunakan timer otomatis lampu 18.00-06.00 WIB.',
      status_lapangan: 'selesai',
      created_at: isoOffsetDays(-4, 9),
      updated_at: isoOffsetDays(-3, 15),
    },
  ];

  const material_logs: DatabaseState['material_logs'] = [
    {
      id: 1,
      order_item_id: 5,
      material_roll_id: 1,
      material_offcut_id: null,
      luas_netto_m2: 18.0,
      wos_finishing_m2: 0.92,
      wos_potong_m2: 0.42,
      gagal_cetak_m2: 0,
      keterangan: 'Selesai cetak | MMT 280 | 6.20 m',
      created_at: isoOffsetDays(0, 9),
    },
    {
      id: 2,
      order_item_id: 6,
      material_roll_id: 3,
      material_offcut_id: null,
      luas_netto_m2: 20.0,
      wos_finishing_m2: 1.93,
      wos_potong_m2: 0.35,
      gagal_cetak_m2: 0,
      keterangan: 'Selesai cetak | MMT 340 | 4.28 m',
      created_at: isoOffsetDays(-1, 14),
    },
    {
      id: 3,
      order_item_id: 10,
      material_roll_id: 5,
      material_offcut_id: null,
      luas_netto_m2: 18.0,
      wos_finishing_m2: 0.76,
      wos_potong_m2: 0.28,
      gagal_cetak_m2: 0,
      keterangan: 'Selesai cetak | Backlit | 6.15 m',
      created_at: isoOffsetDays(-4, 14),
    },
    {
      id: 4,
      order_item_id: 10,
      material_roll_id: 5,
      material_offcut_id: null,
      luas_netto_m2: 0,
      wos_finishing_m2: 0,
      wos_potong_m2: 0,
      gagal_cetak_m2: 1.6,
      keterangan: 'Gagal cetak | Roll BACKLIT-R01 | 0.50 m (nozzle head tersumbat)',
      created_at: isoOffsetDays(-4, 13),
    },
    {
      id: 5,
      order_item_id: 11,
      material_roll_id: 7,
      material_offcut_id: null,
      luas_netto_m2: 12.0,
      wos_finishing_m2: 0,
      wos_potong_m2: 0.3,
      gagal_cetak_m2: 0,
      keterangan: 'Selesai cetak | Stiker Meteran | 5.00 m',
      created_at: isoOffsetDays(-3, 11),
    },
  ];

  const operational_expenses: OperationalExpense[] = [
    {
      id: 1,
      tanggal: dateOffsetDays(-3),
      kategori_biaya: 'Tinta',
      keterangan: 'Pembelian Tinta Eco-Solvent CMYK 4x1 Liter',
      nominal: 850000,
      created_at: isoOffsetDays(-3, 10),
    },
    {
      id: 2,
      tanggal: dateOffsetDays(-2),
      kategori_biaya: 'Listrik & Air',
      keterangan: 'Token Listrik Workshop & AC Ruang Cetak',
      nominal: 450000,
      created_at: isoOffsetDays(-2, 9),
    },
    {
      id: 3,
      tanggal: dateOffsetDays(-1),
      kategori_biaya: 'Perawatan Mesin',
      keterangan: 'Pembersihan Damper & Kalibrasi Printhead Roland',
      nominal: 300000,
      created_at: isoOffsetDays(-1, 15),
    },
  ];

  const suppliers: Supplier[] = [
    {
      id: 1,
      kode_supplier: 'SUP-01',
      nama_supplier: 'CV Sinar Abadi',
      kontak: 'Pak Slamet',
      no_wa: '081234567891',
      alamat: 'Jl. Industri No. 12, Surabaya',
      npwp: '01.234.567.8-901.000',
      aktif: true,
      created_at: isoOffsetDays(-45, 8),
      updated_at: isoOffsetDays(-45, 8),
    },
    {
      id: 2,
      kode_supplier: 'SUP-02',
      nama_supplier: 'PT Maju Grafika',
      kontak: 'Ibu Ratna',
      no_wa: '081234567892',
      alamat: 'Jl. Raya printing No. 8, Sidoarjo',
      npwp: null,
      aktif: true,
      created_at: isoOffsetDays(-30, 9),
      updated_at: isoOffsetDays(-30, 9),
    },
  ];

  return {
    users,
    instansis,
    customers,
    products,
    finishings,
    material_rolls,
    material_offcuts,
    stok_cattoff: buildDefaultStokCattoff(),
    tinta_warna: buildDefaultTintaWarna(),
    pemakaian_tinta: [],
    cetak_grup: [],
    cetak_grup_item: [],
    machines,
    supplies,
    supply_usages: [],
    print_batches: [],
    orders,
    order_items,
    order_payments,
    design_revisions,
    advertising_spks,
    material_logs,
    operational_expenses,
    shifts: [],
    suppliers,
    purchase_orders: [],
    goods_receipts: [],
    supplier_payments: [],
    whatsapp_outbox: [],
    whatsapp_gateway_config: buildDefaultWhatsappGatewayConfig(),
    tax_settings: buildDefaultTaxSettings(),
    audit_logs: [],
    insentif_rates: buildDefaultInsentifRates(),
    counters: {
      users: 6,
      instansis: 5,
      customers: 5,
      products: 13,
      finishings: 7,
      material_rolls: 7,
      material_offcuts: 2,
      stok_cattoff: 1,
      tinta_warna: 4,
      pemakaian_tinta: 0,
      cetak_grup: 0,
      cetak_grup_item: 0,
      machines: 4,
      supplies: 7,
      supply_usages: 0,
      print_batches: 0,
      orders: 6,
      order_items: 11,
      order_payments: 6,
      design_revisions: 2,
      advertising_spks: 2,
      material_logs: 5,
      operational_expenses: 3,
      shifts: 0,
      suppliers: suppliers.length,
      purchase_orders: 0,
      goods_receipts: 0,
      supplier_payments: 0,
      whatsapp_outbox: 0,
      audit_logs: 0,
      insentif_rates: DEFAULT_INSENTIF_RATES.length,
    },
  };
}

class Store {
  private state: DatabaseState;
  private criticalDepth = 0;

  constructor() {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (fs.existsSync(DB_FILE)) {
      try {
        const raw = fs.readFileSync(DB_FILE, 'utf-8');
        this.state = JSON.parse(raw) as DatabaseState;
        this.migrateInMemory();
      } catch (err) {
        // Jangan langsung menimpa database yang rusak. Simpan bukti dulu.
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        const corruptFile = `${DB_FILE}.corrupt-${stamp}`;
        try {
          fs.copyFileSync(DB_FILE, corruptFile);
        } catch (copyErr) {
          console.error('[backup] Gagal menyalin db.json rusak:', copyErr);
        }
        console.error(
          `[store] db.json tidak dapat dibaca (${(err as Error).message}). ` +
            `File asli disimpan sebagai ${corruptFile}. Data seed baru dibuat.`,
        );
        this.state = createInitialSeed();
        this.persist();
      }
    } else {
      this.state = createInitialSeed();
      this.persist();
    }
  }

  private migrateInMemory(): void {
    let changed = false;
    if (!Array.isArray(this.state.order_payments)) {
      this.state.order_payments = [];
      this.state.counters.order_payments = 0;
      changed = true;
    }
    if (!Array.isArray(this.state.shifts)) {
      this.state.shifts = [];
      this.state.counters.shifts = 0;
      changed = true;
    }
    if (!Array.isArray(this.state.audit_logs)) {
      this.state.audit_logs = [];
      this.state.counters.audit_logs = 0;
      changed = true;
    }

    const waDefault = buildDefaultWhatsappGatewayConfig();
    const waConfig = this.state.whatsapp_gateway_config;
    if (!waConfig || typeof waConfig !== 'object') {
      this.state.whatsapp_gateway_config = waDefault;
      changed = true;
    } else {
      if (!Number.isFinite(Number(waConfig.id))) {
        waConfig.id = 1;
        changed = true;
      }
      if (waConfig.webhook_url === undefined || waConfig.webhook_url === null) {
        waConfig.webhook_url = waDefault.webhook_url;
        changed = true;
      }
      if (waConfig.webhook_token === undefined || waConfig.webhook_token === null) {
        waConfig.webhook_token = waDefault.webhook_token;
        changed = true;
      }
      if (waConfig.app_url === undefined || waConfig.app_url === null) {
        waConfig.app_url = waDefault.app_url;
        changed = true;
      }
      if (waConfig.aktif === undefined || waConfig.aktif === null) {
        waConfig.aktif = waDefault.aktif;
        changed = true;
      }
      if (waConfig.updated_at === undefined) {
        waConfig.updated_at = null;
        changed = true;
      }
      if (waConfig.updated_by === undefined) {
        waConfig.updated_by = null;
        changed = true;
      }
    }

    if (!this.state.tax_settings) {
      this.state.tax_settings = buildDefaultTaxSettings();
      changed = true;
    }
    if (!Array.isArray(this.state.stok_cattoff) || this.state.stok_cattoff.length === 0) {
      this.state.stok_cattoff = buildDefaultStokCattoff();
      this.state.counters.stok_cattoff = this.state.stok_cattoff.length;
      changed = true;
    }
    if (!Array.isArray(this.state.tinta_warna) || this.state.tinta_warna.length === 0) {
      this.state.tinta_warna = buildDefaultTintaWarna();
      this.state.counters.tinta_warna = this.state.tinta_warna.length;
      changed = true;
    }
    for (const key of ['pemakaian_tinta', 'cetak_grup', 'cetak_grup_item'] as const) {
      if (!Array.isArray(this.state[key])) {
        (this.state as unknown as Record<string, unknown>)[key] = [];
        this.state.counters[key] = 0;
        changed = true;
      }
    }

    const defaultRates = buildDefaultInsentifRates();
    if (!Array.isArray(this.state.insentif_rates)) {
      this.state.insentif_rates = defaultRates;
      this.state.counters.insentif_rates = defaultRates.length;
      changed = true;
    } else {
      for (const def of defaultRates) {
        const existing = this.state.insentif_rates.find(
          (r) => r.role === def.role && r.jenis === def.jenis,
        );
        if (!existing) {
          this.state.insentif_rates.push(def);
          changed = true;
          continue;
        }
        if (!Number.isFinite(Number(existing.nominal))) {
          existing.nominal = def.nominal;
          changed = true;
        } else {
          existing.nominal = round2(Number(existing.nominal));
        }
        if (existing.updated_at === undefined) {
          existing.updated_at = null;
          changed = true;
        }
        if (existing.updated_by === undefined) {
          existing.updated_by = null;
          changed = true;
        }
      }
    }

    const needsMasterSeed =
      !Array.isArray(this.state.machines) ||
      this.state.machines.length === 0 ||
      !Array.isArray(this.state.supplies) ||
      this.state.supplies.length === 0 ||
      !Array.isArray(this.state.suppliers) ||
      this.state.suppliers.length === 0;
    const seed = needsMasterSeed ? createInitialSeed(false) : null;
    if (seed) {
      if (!Array.isArray(this.state.machines) || this.state.machines.length === 0) {
        this.state.machines = seed.machines;
        this.state.counters.machines = seed.machines.length;
        changed = true;
      }
      if (!Array.isArray(this.state.supplies) || this.state.supplies.length === 0) {
        this.state.supplies = seed.supplies;
        this.state.counters.supplies = seed.supplies.length;
        changed = true;
      }
      if (!Array.isArray(this.state.suppliers) || this.state.suppliers.length === 0) {
        this.state.suppliers = seed.suppliers;
        this.state.counters.suppliers = seed.suppliers.length;
        changed = true;
      }
      for (const p of seed.products.filter((sp) => sp.id >= 11)) {
        if (!this.state.products.some((existing) => existing.nama_produk === p.nama_produk)) {
          this.state.products.push(p);
          changed = true;
        }
      }
    }
    if (!Array.isArray(this.state.supply_usages)) {
      this.state.supply_usages = [];
      this.state.counters.supply_usages = 0;
      changed = true;
    }
    if (!Array.isArray(this.state.print_batches)) {
      this.state.print_batches = [];
      this.state.counters.print_batches = 0;
      changed = true;
    }
    for (const key of ['purchase_orders', 'goods_receipts', 'supplier_payments', 'whatsapp_outbox'] as const) {
      if (!Array.isArray(this.state[key])) {
        (this.state as unknown as Record<string, unknown>)[key] = [];
        this.state.counters[key] = 0;
        changed = true;
      }
    }

    const resetPasswords: Array<{ email: string; password: string }> = [];
    for (const u of this.state.users) {
      if (!u.password.startsWith('scrypt:')) {
        if (u.password === 'password123') {
          const replacement = generateSeedPassword();
          resetPasswords.push({ email: u.email, password: replacement });
          u.password = hashPassword(replacement);
        } else {
          u.password = hashPassword(u.password);
        }
        changed = true;
      } else {
        let isDefault = false;
        try {
          isDefault = verifyPassword('password123', u.password);
        } catch {
          isDefault = false;
        }
        if (isDefault) {
          const replacement = generateSeedPassword();
          resetPasswords.push({ email: u.email, password: replacement });
          u.password = hashPassword(replacement);
          changed = true;
        }
      }
      if (typeof u.active !== 'boolean') {
        u.active = true;
        changed = true;
      }
    }
    writePasswordResetReport(resetPasswords);
    for (const inst of this.state.instansis) {
      if (inst.npwp === undefined) {
        inst.npwp = null;
        inst.is_pkp = false;
        inst.ppn_persen = 0;
        inst.pph23_persen = 0;
        inst.tempo_hari = 0;
        inst.credit_limit = 0;
        inst.pajak_reklame_expired = null;
        changed = true;
      }
    }
    for (const p of this.state.products) {
      if (p.mesin_default_id === undefined) {
        const name = p.nama_produk.toLowerCase();
        p.mesin_default_id =
          p.kategori_produk === 'meteran' ? 1 : name.includes('a3') ? 3 : null;
        changed = true;
      }
      if (p.satuan_hitung === undefined) {
        p.satuan_hitung = 'pcs';
        changed = true;
      }
      if (p.klik_per_lembar === undefined) {
        p.klik_per_lembar = p.satuan_hitung === 'klik' ? 2 : 1;
        changed = true;
      }
      if (p.ukuran_lembar === undefined) {
        p.ukuran_lembar = null;
        changed = true;
      }
    }
    this.state.counters.products = Math.max(
      this.state.counters.products ?? 0,
      ...this.state.products.map((p) => p.id),
    );

    for (const order of this.state.orders) {
      if (order.status_nota === undefined) {
        order.status_nota = 'aktif';
        order.alasan_batal = null;
        order.diskon_persen = 0;
        order.diskon_nominal = 0;
        order.ppn_persen = 0;
        order.ppn_nominal = 0;
        order.pph23_persen = 0;
        order.pph23_nominal = 0;
        order.jatuh_tempo = null;
        order.approval_token = null;
        order.approval_status = 'belum';
        order.approval_note = null;
        changed = true;
      }
      if (order.tanda_tangan_pengambil === undefined) {
        order.tanda_tangan_pengambil = null;
        changed = true;
      }
      if (order.kurir_nama === undefined) {
        order.kurir_nama = null;
        changed = true;
      }
      if (order.resi_pengiriman === undefined) {
        order.resi_pengiriman = null;
        changed = true;
      }
      if (order.biaya_desain === undefined) {
        order.biaya_desain = 0;
        changed = true;
      }
    }
    for (const item of this.state.order_items) {
      if (item.diskon_persen === undefined) {
        item.diskon_persen = 0;
        item.diskon_nominal = 0;
        item.harga_sebelum_diskon = item.subtotal;
        changed = true;
      }
      const product = this.state.products.find((p) => p.id === item.product_id);
      if (item.machine_id === undefined) {
        item.machine_id = product?.mesin_default_id ?? null;
        changed = true;
      }
      if (item.operator_id === undefined) {
        item.operator_id = null;
        item.waktu_mulai_cetak = null;
        item.waktu_selesai_cetak = null;
        changed = true;
      }
      if (item.finishing_user_id === undefined) {
        item.finishing_user_id = null;
        changed = true;
      }
      if (item.klik_total === undefined) {
        item.klik_total = null;
        item.estimasi_tinta_ml = null;
        item.batch_id = null;
        changed = true;
      }
      if (item.satuan_hitung === undefined) {
        item.satuan_hitung = product?.satuan_hitung ?? 'pcs';
        item.klik_per_lembar = product?.klik_per_lembar ?? 1;
        item.ukuran_lembar = product?.ukuran_lembar ?? null;
        changed = true;
      }
      if (item.preflight_dpi_ok === undefined) {
        item.preflight_dpi_ok = null;
        item.preflight_cmyk_ok = null;
        item.preflight_bleed_ok = null;
        item.preflight_catatan = null;
        changed = true;
      }
    }
    for (const payment of this.state.order_payments) {
      if (payment.shift_id === undefined) {
        payment.shift_id = null;
        changed = true;
      }
    }
    // Sinkronkan SEMUA counter dengan ID maksimum yang benar-benar ada.
    // Dulu hanya sebagian tabel yang disinkronkan sehingga tabel seperti `users`
    // bisa mulai dari 1 lagi dan menabrak ID akun yang sudah ada.
    for (const [key, value] of Object.entries(this.state)) {
      if (!Array.isArray(value)) continue;
      const rows = value as Array<{ id?: number }>;
      const maxId = rows.reduce(
        (max, row) => Math.max(max, Number.isFinite(Number(row?.id)) ? Number(row?.id) : 0),
        0,
      );
      this.state.counters[key] = Math.max(this.state.counters[key] ?? 0, maxId);
    }
    if (changed) {
      this.persist();
    }
  }

  public async init(): Promise<void> {
    if (mysqlAdapter.isEnabled()) {
      this.state = await mysqlAdapter.initialize(() => createInitialSeed(true));
      this.migrateInMemory();
      console.log('Reffo PrintFlow terhubung ke MySQL localhost.');
    }
  }

  public getState(): DatabaseState {
    return this.state;
  }

  public nextId(table: keyof DatabaseState['counters']): number {
    const current = this.state.counters[table] ?? 0;
    const next = current + 1;
    this.state.counters[table] = next;
    return next;
  }

  public persist(): void {
    if (mysqlAdapter.isEnabled()) {
      // Operasi kritis menulis perubahan di dalam transaksi yang sama
      // (lihat critical()), jadi jangan antre snapshot tambahan.
      if (this.criticalDepth > 0) return;
      mysqlAdapter.queuePersist(this.state);
      return;
    }
    const tmpFile = `${DB_FILE}.tmp`;
    fs.writeFileSync(tmpFile, JSON.stringify(this.state, null, 2), 'utf-8');
    fs.renameSync(tmpFile, DB_FILE);
  }

  /**
   * Jalankan mutasi stok/transaksi kritis dengan lock baris MySQL
   * (SELECT ... FOR UPDATE) dan persist CRUD per entitas dalam satu transaksi.
   * Bila gagal, state di memori dikembalikan ke snapshot sebelumnya.
   */
  public async critical<T>(
    tables: SyncTable[],
    fn: () => T | Promise<T>,
  ): Promise<T> {
    if (!mysqlAdapter.isEnabled()) {
      const snapshot = JSON.parse(JSON.stringify(this.state)) as DatabaseState;
      try {
        return await fn();
      } catch (err) {
        this.state = snapshot;
        throw err;
      }
    }
    const snapshot = JSON.parse(JSON.stringify(this.state)) as DatabaseState;
    this.criticalDepth += 1;
    try {
      return await mysqlAdapter.runLocked(() => this.state, tables, fn);
    } catch (err) {
      this.state = snapshot;
      throw err;
    } finally {
      this.criticalDepth -= 1;
    }
  }

  public resetSeed(): void {
    backupDatabaseFile('pre-reset');
    this.state = createInitialSeed();
    this.persist();
  }

  public hydrateItem(raw: DatabaseState['order_items'][number]): OrderItem {
    const product = this.state.products.find((p) => p.id === raw.product_id);
    const finishing = raw.finishing_id
      ? this.state.finishings.find((f) => f.id === raw.finishing_id) ?? null
      : null;
    const accAdmin = raw.acc_admin_id
      ? this.state.users.find((u) => u.id === raw.acc_admin_id)
      : null;
    const machine = raw.machine_id
      ? this.state.machines.find((m) => m.id === raw.machine_id) ?? null
      : null;
    const operator = raw.operator_id
      ? this.state.users.find((u) => u.id === raw.operator_id)
      : null;
    const finishingUser = raw.finishing_user_id
      ? this.state.users.find((u) => u.id === raw.finishing_user_id)
      : null;

    const isMeteran = product?.kategori_produk === 'meteran';
    const ukuranKotor =
      isMeteran && raw.lebar_m && raw.tinggi_m
        ? computeUkuranKotor(raw.lebar_m, raw.tinggi_m, raw.qty, finishing)
        : null;

    let rekomendasiRoll: string | null = null;
    if (isMeteran && product?.nama_produk.toLowerCase().includes('stiker') && ukuranKotor) {
      if (ukuranKotor.lebar <= 1.0) rekomendasiRoll = 'Stiker 1m';
      else if (ukuranKotor.lebar <= 1.5) rekomendasiRoll = 'Stiker 1.5m';
    }

    return {
      ...raw,
      harga_sebelum_diskon: raw.harga_sebelum_diskon ?? raw.subtotal,
      diskon_persen: raw.diskon_persen ?? 0,
      diskon_nominal: raw.diskon_nominal ?? 0,
      product_name: product?.nama_produk ?? 'Produk',
      product_category: product?.kategori_produk ?? 'meteran',
      stok_pcs: product?.stok_pcs ?? null,
      finishing_name: finishing?.nama_finishing ?? null,
      ekstra_finishing: finishing
        ? {
            kiri_cm: finishing.ekstra_kiri_cm,
            kanan_cm: finishing.ekstra_kanan_cm,
            atas_cm: finishing.ekstra_atas_cm,
            bawah_cm: finishing.ekstra_bawah_cm,
          }
        : undefined,
      ukuran_kotor: ukuranKotor,
      rekomendasi_roll: rekomendasiRoll,
      machine_name: machine?.nama_mesin ?? null,
      operator_name: operator?.name ?? null,
      finishing_user_name: finishingUser?.name ?? null,
      satuan_hitung: raw.satuan_hitung ?? product?.satuan_hitung ?? 'pcs',
      klik_per_lembar: raw.klik_per_lembar ?? product?.klik_per_lembar ?? 1,
      ukuran_lembar: raw.ukuran_lembar ?? product?.ukuran_lembar ?? null,
      acc_admin_name: accAdmin?.name ?? null,
    };
  }

  public hydrateOrder(raw: DatabaseState['orders'][number]): Order {
    const customer = this.state.customers.find((c) => c.id === raw.customer_id);
    const admin = this.state.users.find((u) => u.id === raw.user_id);
    const designer = raw.designer_id
      ? this.state.users.find((u) => u.id === raw.designer_id)
      : null;

    const items = this.state.order_items
      .filter((i) => i.order_id === raw.id)
      .map((i) => this.hydrateItem(i));

    const revisions = this.state.design_revisions
      .filter((r) => r.order_id === raw.id)
      .sort((a, b) => b.revisi_ke - a.revisi_ke)
      .map((r) => ({
        ...r,
        admin_name: r.admin_id
          ? this.state.users.find((u) => u.id === r.admin_id)?.name ?? null
          : null,
      }));

    const spks = this.state.advertising_spks
      .filter((s) => s.order_id === raw.id)
      .map((s) => ({
        ...s,
        no_nota: raw.no_nota,
        instansi: customer?.instansi ?? 'Perorangan',
        nama_pelanggan: customer?.nama_pelanggan ?? '-',
        deadline: raw.deadline,
      }));

    const payments = (this.state.order_payments ?? [])
      .filter((p) => p.order_id === raw.id)
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
      .map((p) => ({
        ...p,
        admin_name: this.state.users.find((u) => u.id === p.admin_id)?.name ?? 'Admin',
      }));

    const statusNota = raw.status_nota ?? 'aktif';
    return {
      ...raw,
      status_nota: statusNota,
      alasan_batal: raw.alasan_batal ?? null,
      diskon_persen: raw.diskon_persen ?? 0,
      diskon_nominal: raw.diskon_nominal ?? 0,
      ppn_persen: raw.ppn_persen ?? 0,
      ppn_nominal: raw.ppn_nominal ?? 0,
      pph23_persen: raw.pph23_persen ?? 0,
      pph23_nominal: raw.pph23_nominal ?? 0,
      jatuh_tempo: raw.jatuh_tempo ?? null,
      approval_token: raw.approval_token ?? null,
      approval_status: raw.approval_status ?? 'belum',
      approval_note: raw.approval_note ?? null,
      tanda_tangan_pengambil: raw.tanda_tangan_pengambil ?? null,
      customer,
      admin_name: admin?.name ?? 'Admin',
      designer_name: designer?.name ?? null,
      sisa_tagihan:
        statusNota === 'batal'
          ? 0
          : round2(Math.max(raw.total_tagihan - raw.jumlah_dp, 0)),
      items,
      design_revisions: revisions,
      advertising_spks: spks,
      payments,
    };
  }

  public generateNoNota(): string {
    const today = notaDateStr(0);
    const prefix = `INV-${today}-`;
    const matching = this.state.orders
      .filter((o) => o.no_nota.startsWith(prefix))
      .map((o) => parseInt(o.no_nota.slice(-4), 10) || 0);
    const maxSeq = matching.length > 0 ? Math.max(...matching) : 0;
    return `${prefix}${String(maxSeq + 1).padStart(4, '0')}`;
  }

  public isOrderSiapDiambil(order: Order): boolean {
    if (order.status_nota === 'batal') return false;
    if (order.items.length === 0 || order.waktu_serah_terima !== null) return false;
    const hasReady = order.items.some((i) => i.status_produksi === 'siap_diambil');
    const allFinishedOrReady = order.items.every(
      (i) => i.status_produksi === 'siap_diambil' || i.status_produksi === 'selesai',
    );
    return hasReady && allFinishedOrReady;
  }

  public isOrderSelesai(order: Order): boolean {
    return (
      order.status_nota !== 'batal' &&
      order.items.length > 0 &&
      order.items.every((i) => i.status_produksi === 'selesai')
    );
  }
}

export const store = new Store();

export type {
  ExpenseCategory,
  ProductionStatus,
  SpkFieldStatus,
};

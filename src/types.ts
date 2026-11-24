export type UserRole =
  | 'admin'
  | 'desainer'
  | 'operator_cetak'
  | 'finishing'
  | 'advertising'
  | 'owner';

export type CustomerCategory = 'umum' | 'reseller' | 'prioritas' | 'pegawai';

export type ProductCategory = 'meteran' | 'satuan';

export type PaymentStatus = 'belum_lunas' | 'dp' | 'lunas';

export type DesignStatus =
  | 'belum_ada_file'
  | 'file_mentah'
  | 'coretan_kertas'
  | 'siap_cetak_tiff';

export type ProductionStatus =
  | 'menunggu_desain'
  | 'proses_desain'
  | 'menunggu_acc'
  | 'revisi'
  | 'antrean_cetak'
  | 'proses_cetak'
  | 'antrean_finishing'
  | 'proses_finishing'
  | 'siap_diambil'
  | 'selesai';

export type SpkFieldStatus = 'antrean' | 'perakitan' | 'pemasangan' | 'selesai';

export type ExpenseCategory =
  | 'Gaji'
  | 'Listrik & Air'
  | 'Tinta'
  | 'Perawatan Mesin'
  | 'Lain-lain';

export interface User {
  id: number;
  name: string;
  email: string;
  role: UserRole;
  active?: boolean;
}

export interface Instansi {
  id: number;
  nama_instansi: string;
  npwp?: string | null;
  is_pkp?: boolean;
  ppn_persen?: number;
  pph23_persen?: number;
  tempo_hari?: number;
  credit_limit?: number;
  pajak_reklame_expired?: string | null;
}

export interface Customer {
  id: number;
  instansi_id: number;
  instansi: string;
  nama_pelanggan: string;
  no_wa: string;
  kategori: CustomerCategory;
  alamat: string | null;
}

export type MachineKind = 'large_format' | 'uv' | 'digital_a3p' | 'cutting';

export interface PrintMachine {
  id: number;
  kode_mesin: string;
  nama_mesin: string;
  jenis: MachineKind;
  lebar_max_m: number | null;
  konsumsi_tinta_ml_per_m2: number;
  aktif: boolean;
  keterangan: string | null;
  created_at: string;
  updated_at: string;
}

export type SupplyCategory = 'tinta' | 'bahan_pembantu' | 'suku_cadang';

export interface SupplyItem {
  id: number;
  kode: string;
  nama: string;
  kategori: SupplyCategory;
  satuan: string;
  stok: number;
  stok_minimum: number;
  harga_satuan: number;
  konsumsi_per_m2: number | null;
  aktif: boolean;
  created_at: string;
  updated_at: string;
}

export interface SupplyUsage {
  id: number;
  supply_id: number;
  supply_name?: string;
  order_item_id: number | null;
  no_nota?: string | null;
  jumlah: number;
  satuan: string;
  keterangan: string | null;
  user_id: number;
  user_name?: string;
  created_at: string;
}

export interface PrintBatch {
  id: number;
  kode_batch: string;
  machine_id: number;
  machine_name?: string | null;
  operator_id: number;
  operator_name?: string | null;
  item_ids: number[];
  lebar_gabungan_m: number;
  panjang_tarik_m: number;
  luas_terpakai_m2: number;
  luas_waste_m2: number;
  status: 'dihitung' | 'diproses';
  catatan: string | null;
  created_at: string;
}

export interface Supplier {
  id: number;
  kode_supplier: string;
  nama_supplier: string;
  kontak: string | null;
  no_wa: string | null;
  alamat: string | null;
  npwp: string | null;
  aktif: boolean;
  created_at: string;
  updated_at: string;
}

export type PurchaseOrderStatus = 'draft' | 'dikirim' | 'diterima' | 'batal';
export type PurchaseOrderItemKind = 'roll' | 'supply' | 'produk';

export interface PurchaseOrderItem {
  id: number;
  po_id?: number;
  jenis: PurchaseOrderItemKind;
  referensi_id: number;
  nama_barang: string;
  kode_roll: string | null;
  jenis_bahan: string | null;
  lebar_m: number | null;
  satuan: string;
  qty: number;
  harga_satuan: number;
  subtotal: number;
  created_at?: string;
}

export interface PurchaseOrder {
  id: number;
  no_po: string;
  supplier_id: number;
  supplier_name?: string | null;
  tanggal: string;
  expected_at: string | null;
  status: PurchaseOrderStatus;
  catatan: string | null;
  total: number;
  sudah_dibayar: number;
  hutang: number;
  diterima_at: string | null;
  created_at: string;
  updated_at: string;
  items: PurchaseOrderItem[];
}

export interface GoodsReceipt {
  id: number;
  po_id: number;
  no_po: string;
  tanggal: string;
  admin_id: number;
  admin_name?: string | null;
  catatan: string | null;
  created_at: string;
}

export interface SupplierPayment {
  id: number;
  supplier_id: number;
  supplier_name?: string | null;
  purchase_order_id: number;
  no_po?: string | null;
  tanggal: string;
  nominal: number;
  metode: PaymentMethod;
  keterangan: string | null;
  admin_id: number;
  admin_name?: string | null;
  created_at: string;
}

export type WhatsAppEvent =
  | 'nota_dibuat'
  | 'preview_siap_acc'
  | 'siap_diambil'
  | 'piutang_jatuh_tempo'
  | 'pajak_reklame_jatuh_tempo';

export type InsentifRole = 'desainer' | 'operator_cetak' | 'finishing';
export type InsentifJenis = 'per_item' | 'per_job';

export interface InsentifRate {
  id: number;
  role: InsentifRole;
  jenis: InsentifJenis;
  nominal: number;
  updated_at: string | null;
  updated_by: number | null;
}

export interface WhatsappOutbox {
  id: number;
  event: WhatsAppEvent;
  dedupe_key: string;
  order_id: number | null;
  no_wa: string;
  pesan: string;
  link: string | null;
  status: 'pending' | 'terkirim' | 'gagal';
  attempts: number;
  last_error: string | null;
  next_attempt_at: string | null;
  created_at: string;
  updated_at: string;
  sent_at: string | null;
}

export interface Product {
  id: number;
  nama_produk: string;
  kategori_produk: ProductCategory;
  harga_umum: number;
  harga_reseller: number;
  harga_prioritas: number;
  harga_pegawai: number;
  harga_modal: number;
  stok_pcs: number | null;
  mesin_default_id?: number | null;
  satuan_hitung?: 'pcs' | 'klik';
  klik_per_lembar?: number;
  ukuran_lembar?: string | null;
}

export interface Finishing {
  id: number;
  nama_finishing: string;
  ekstra_kiri_cm: number;
  ekstra_kanan_cm: number;
  ekstra_atas_cm: number;
  ekstra_bawah_cm: number;
}

export interface MaterialRoll {
  id: number;
  kode_roll: string;
  jenis_bahan: string;
  lebar_m: number;
  panjang_awal_m: number;
  panjang_sisa_m: number;
  status: 'aktif' | 'habis';
}

export interface MaterialOffcut {
  id: number;
  material_roll_id: number | null;
  kode_roll?: string | null;
  jenis_bahan: string;
  lebar_m: number;
  panjang_m: number;
  luas_m2: number;
  status: 'tersedia' | 'terpakai';
  created_at: string;
}

export interface DesignRevision {
  id: number;
  order_id: number;
  order_item_id: number | null;
  revisi_ke: number;
  catatan_revisi: string;
  file_preview: string | null;
  admin_id: number | null;
  admin_name?: string | null;
  status_revisi: 'menunggu' | 'selesai' | null;
  created_at: string;
}

export interface AdvertisingSpk {
  id: number;
  order_id: number;
  no_nota?: string;
  instansi?: string;
  nama_pelanggan?: string;
  deadline?: string | null;
  jenis_pekerjaan: string;
  ukuran_konstruksi: string;
  lokasi_pasang: string;
  catatan_teknis: string | null;
  status_lapangan: SpkFieldStatus;
  created_at: string;
  updated_at: string;
}

export interface OrderItem {
  id: number;
  order_id: number;
  nama_item: string | null;
  product_id: number;
  product_name?: string;
  product_category?: ProductCategory;
  stok_pcs?: number | null;
  finishing_id: number | null;
  finishing_name?: string | null;
  ekstra_finishing?: {
    kiri_cm: number;
    kanan_cm: number;
    atas_cm: number;
    bawah_cm: number;
  };
  ukuran_kotor?: {
    lebar: number;
    tinggi: number;
    luas: number;
  } | null;
  rekomendasi_roll?: string | null;
  lebar_m: number | null;
  tinggi_m: number | null;
  qty: number;
  luas_tagihan_m2: number | null;
  harga_satuan_dipakai: number;
  harga_sebelum_diskon?: number;
  diskon_persen?: number;
  diskon_nominal?: number;
  subtotal: number;
  status_produksi: ProductionStatus;
  machine_id?: number | null;
  machine_name?: string | null;
  operator_id?: number | null;
  operator_name?: string | null;
  finishing_user_id?: number | null;
  finishing_user_name?: string | null;
  waktu_mulai_cetak?: string | null;
  waktu_selesai_cetak?: string | null;
  klik_total?: number | null;
  estimasi_tinta_ml?: number | null;
  batch_id?: number | null;
  satuan_hitung?: 'pcs' | 'klik';
  klik_per_lembar?: number;
  ukuran_lembar?: string | null;
  acc_admin_id: number | null;
  acc_admin_name?: string | null;
  waktu_acc: string | null;
  file_preview_acc: string | null;
  file_cetak_tiff: string | null;
  file_master_arsip: string | null;
  created_at: string;
  updated_at: string;
}

export type PaymentMethod = 'Tunai' | 'Transfer' | 'QRIS';

export interface OrderPayment {
  id: number;
  order_id: number;
  tanggal: string;
  nominal: number;
  metode: PaymentMethod;
  keterangan: string | null;
  bukti_bayar: string | null;
  admin_id: number;
  admin_name?: string;
  shift_id?: number | null;
  created_at: string;
}

export interface Order {
  id: number;
  no_nota: string;
  customer_id: number;
  customer?: Customer;
  user_id: number;
  admin_name?: string;
  designer_id: number | null;
  designer_name?: string | null;
  total_tagihan: number;
  jumlah_dp: number;
  sisa_tagihan: number;
  status_bayar: PaymentStatus;
  status_nota?: 'aktif' | 'batal';
  alasan_batal?: string | null;
  diskon_persen?: number;
  diskon_nominal?: number;
  ppn_persen?: number;
  ppn_nominal?: number;
  pph23_persen?: number;
  pph23_nominal?: number;
  jatuh_tempo?: string | null;
  approval_token?: string | null;
  approval_status?: 'belum' | 'menunggu' | 'disetujui' | 'revisi';
  approval_note?: string | null;
  status_desain: DesignStatus;
  catatan_desain: string | null;
  lampiran_briefing: string | null;
  file_master_arsip: string | null;
  waktu_terima_desain: string | null;
  waktu_selesai_desain: string | null;
  tanda_tangan_desainer: string | null;
  tanda_tangan_admin: string | null;
  bukti_pelunasan: string | null;
  foto_serah_terima: string | null;
  tanda_tangan_pengambil: string | null;
  nama_pengambil: string | null;
  no_wa_pengambil: string | null;
  waktu_serah_terima: string | null;
  catatan_pengecualian: string | null;
  deadline: string | null;
  created_at: string;
  updated_at: string;
  items: OrderItem[];
  design_revisions: DesignRevision[];
  advertising_spks: AdvertisingSpk[];
  payments: OrderPayment[];
}

export interface MaterialLog {
  id: number;
  order_item_id: number;
  no_nota?: string;
  product_name?: string;
  material_roll_id: number | null;
  kode_roll?: string | null;
  material_offcut_id: number | null;
  luas_netto_m2: number;
  wos_finishing_m2: number;
  wos_potong_m2: number;
  gagal_cetak_m2: number;
  keterangan: string | null;
  created_at: string;
}

export interface OperationalExpense {
  id: number;
  tanggal: string;
  kategori_biaya: ExpenseCategory;
  keterangan: string;
  nominal: number;
  created_at: string;
}

export interface Shift {
  id: number;
  kasir_id: number;
  kasir_name?: string;
  opened_at: string;
  closed_at: string | null;
  opening_cash: number;
  expected_tunai: number;
  expected_transfer: number;
  expected_qris: number;
  actual_tunai: number;
  actual_transfer: number;
  actual_qris: number;
  selisih: number;
  catatan: string | null;
  status: 'buka' | 'tutup';
}

export interface AuditLog {
  id: number;
  user_id: number;
  user_name: string;
  role: UserRole;
  action: string;
  entity: string;
  entity_id: number | null;
  detail: string;
  created_at: string;
  ip: string | null;
}

export interface BootstrapPayload {
  user: User;
  products: Product[];
  finishings: Finishing[];
  instansis: Instansi[];
  customers: Customer[];
  rolls: MaterialRoll[];
  offcuts: MaterialOffcut[];
  machines: PrintMachine[];
  supplies: SupplyItem[];
  demo_switch_enabled?: boolean;
  shifts?: Shift[];
}

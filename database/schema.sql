-- Skema Database MySQL 8 / MariaDB untuk Reffo PrintFlow
-- Jalankan file ini di phpMyAdmin / MySQL Workbench / CLI jika ingin setup manual,
-- atau cukup atur DB_DRIVER=mysql di .env agar server membuat tabel & seed otomatis.

CREATE DATABASE IF NOT EXISTS reffo_printflow
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE reffo_printflow;

CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(150) NOT NULL UNIQUE,
  role ENUM('admin','desainer','operator_cetak','finishing','advertising','owner') NOT NULL,
  password VARCHAR(255) NOT NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS instansis (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nama_instansi VARCHAR(150) NOT NULL UNIQUE,
  npwp VARCHAR(40) NULL,
  is_pkp TINYINT(1) NOT NULL DEFAULT 0,
  ppn_persen DECIMAL(5,2) NOT NULL DEFAULT 0,
  pph23_persen DECIMAL(5,2) NOT NULL DEFAULT 0,
  tempo_hari INT NOT NULL DEFAULT 0,
  credit_limit DECIMAL(14,2) NOT NULL DEFAULT 0,
  pajak_reklame_expired VARCHAR(40) NULL
);

CREATE TABLE IF NOT EXISTS customers (
  id INT AUTO_INCREMENT PRIMARY KEY,
  instansi_id INT NOT NULL,
  instansi VARCHAR(150) NOT NULL,
  nama_pelanggan VARCHAR(150) NOT NULL,
  no_wa VARCHAR(30) NOT NULL,
  kategori ENUM('umum','reseller','prioritas','pegawai') NOT NULL DEFAULT 'umum',
  alamat TEXT NULL,
  FOREIGN KEY (instansi_id) REFERENCES instansis(id)
);

CREATE TABLE IF NOT EXISTS products (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nama_produk VARCHAR(120) NOT NULL UNIQUE,
  kategori_produk ENUM('meteran','satuan') NOT NULL,
  harga_umum DECIMAL(12,2) NOT NULL,
  harga_reseller DECIMAL(12,2) NOT NULL,
  harga_prioritas DECIMAL(12,2) NOT NULL,
  harga_pegawai DECIMAL(12,2) NOT NULL,
  harga_modal DECIMAL(12,2) NOT NULL,
  stok_pcs INT NULL,
  mesin_default_id INT NULL,
  satuan_hitung ENUM('pcs','klik') NOT NULL DEFAULT 'pcs',
  klik_per_lembar INT NOT NULL DEFAULT 1,
  ukuran_lembar VARCHAR(80) NULL
);

CREATE TABLE IF NOT EXISTS print_machines (
  id INT AUTO_INCREMENT PRIMARY KEY,
  kode_mesin VARCHAR(40) NOT NULL UNIQUE,
  nama_mesin VARCHAR(120) NOT NULL UNIQUE,
  jenis ENUM('large_format','uv','digital_a3p','cutting') NOT NULL,
  lebar_max_m DECIMAL(6,3) NULL,
  konsumsi_tinta_ml_per_m2 DECIMAL(8,2) NOT NULL DEFAULT 0,
  aktif TINYINT(1) NOT NULL DEFAULT 1,
  keterangan TEXT NULL,
  created_at VARCHAR(40) NOT NULL,
  updated_at VARCHAR(40) NOT NULL
);

CREATE TABLE IF NOT EXISTS supplies (
  id INT AUTO_INCREMENT PRIMARY KEY,
  kode VARCHAR(50) NOT NULL UNIQUE,
  nama VARCHAR(150) NOT NULL,
  kategori ENUM('tinta','bahan_pembantu','suku_cadang') NOT NULL,
  satuan VARCHAR(20) NOT NULL DEFAULT 'pcs',
  stok DECIMAL(12,2) NOT NULL DEFAULT 0,
  stok_minimum DECIMAL(12,2) NOT NULL DEFAULT 0,
  harga_satuan DECIMAL(12,2) NOT NULL DEFAULT 0,
  konsumsi_per_m2 DECIMAL(8,2) NULL,
  aktif TINYINT(1) NOT NULL DEFAULT 1,
  created_at VARCHAR(40) NOT NULL,
  updated_at VARCHAR(40) NOT NULL
);

CREATE TABLE IF NOT EXISTS finishings (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nama_finishing VARCHAR(120) NOT NULL UNIQUE,
  ekstra_kiri_cm DECIMAL(5,2) NOT NULL DEFAULT 0,
  ekstra_kanan_cm DECIMAL(5,2) NOT NULL DEFAULT 0,
  ekstra_atas_cm DECIMAL(5,2) NOT NULL DEFAULT 0,
  ekstra_bawah_cm DECIMAL(5,2) NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS material_rolls (
  id INT AUTO_INCREMENT PRIMARY KEY,
  kode_roll VARCHAR(50) NOT NULL UNIQUE,
  jenis_bahan VARCHAR(50) NOT NULL,
  lebar_m DECIMAL(5,2) NOT NULL,
  panjang_awal_m DECIMAL(8,2) NOT NULL,
  panjang_sisa_m DECIMAL(8,2) NOT NULL,
  status ENUM('aktif','habis') NOT NULL DEFAULT 'aktif'
);

CREATE TABLE IF NOT EXISTS material_offcuts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  material_roll_id INT NULL,
  kode_roll VARCHAR(50) NULL,
  jenis_bahan VARCHAR(50) NOT NULL,
  lebar_m DECIMAL(5,2) NOT NULL,
  panjang_m DECIMAL(8,2) NOT NULL,
  luas_m2 DECIMAL(8,2) NOT NULL,
  status ENUM('tersedia','terpakai') NOT NULL DEFAULT 'tersedia',
  created_at VARCHAR(40) NOT NULL,
  FOREIGN KEY (material_roll_id) REFERENCES material_rolls(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS orders (
  id INT AUTO_INCREMENT PRIMARY KEY,
  no_nota VARCHAR(30) NOT NULL UNIQUE,
  customer_id INT NOT NULL,
  user_id INT NOT NULL,
  designer_id INT NULL,
  total_tagihan DECIMAL(12,2) NOT NULL DEFAULT 0,
  jumlah_dp DECIMAL(12,2) NOT NULL DEFAULT 0,
  status_bayar ENUM('belum_lunas','dp','lunas') NOT NULL DEFAULT 'belum_lunas',
  status_nota ENUM('aktif','batal') NOT NULL DEFAULT 'aktif',
  alasan_batal TEXT NULL,
  diskon_persen DECIMAL(5,2) NOT NULL DEFAULT 0,
  diskon_nominal DECIMAL(12,2) NOT NULL DEFAULT 0,
  ppn_persen DECIMAL(5,2) NOT NULL DEFAULT 0,
  ppn_nominal DECIMAL(12,2) NOT NULL DEFAULT 0,
  pph23_persen DECIMAL(5,2) NOT NULL DEFAULT 0,
  pph23_nominal DECIMAL(12,2) NOT NULL DEFAULT 0,
  jatuh_tempo VARCHAR(40) NULL,
  approval_token VARCHAR(80) NULL,
  approval_status ENUM('belum','menunggu','disetujui','revisi') NOT NULL DEFAULT 'belum',
  approval_note TEXT NULL,
  status_desain ENUM('belum_ada_file','file_mentah','coretan_kertas','siap_cetak_tiff') NOT NULL DEFAULT 'belum_ada_file',
  catatan_desain TEXT NULL,
  lampiran_briefing VARCHAR(255) NULL,
  file_master_arsip VARCHAR(255) NULL,
  waktu_terima_desain VARCHAR(40) NULL,
  waktu_selesai_desain VARCHAR(40) NULL,
  tanda_tangan_desainer VARCHAR(100) NULL,
  tanda_tangan_admin VARCHAR(100) NULL,
  bukti_pelunasan VARCHAR(255) NULL,
  foto_serah_terima VARCHAR(255) NULL,
  tanda_tangan_pengambil LONGTEXT NULL,
  nama_pengambil VARCHAR(150) NULL,
  no_wa_pengambil VARCHAR(30) NULL,
  waktu_serah_terima VARCHAR(40) NULL,
  catatan_pengecualian TEXT NULL,
  deadline VARCHAR(40) NULL,
  created_at VARCHAR(40) NOT NULL,
  updated_at VARCHAR(40) NOT NULL,
  FOREIGN KEY (customer_id) REFERENCES customers(id),
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (designer_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS order_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  order_id INT NOT NULL,
  nama_item VARCHAR(150) NULL,
  product_id INT NOT NULL,
  finishing_id INT NULL,
  lebar_m DECIMAL(6,2) NULL,
  tinggi_m DECIMAL(6,2) NULL,
  qty INT NOT NULL,
  luas_tagihan_m2 DECIMAL(8,2) NULL,
  harga_satuan_dipakai DECIMAL(12,2) NOT NULL,
  harga_sebelum_diskon DECIMAL(12,2) NOT NULL DEFAULT 0,
  diskon_persen DECIMAL(5,2) NOT NULL DEFAULT 0,
  diskon_nominal DECIMAL(12,2) NOT NULL DEFAULT 0,
  subtotal DECIMAL(12,2) NOT NULL,
  status_produksi ENUM(
    'menunggu_desain','proses_desain','menunggu_acc','revisi',
    'antrean_cetak','proses_cetak','antrean_finishing',
    'proses_finishing','siap_diambil','selesai'
  ) NOT NULL DEFAULT 'menunggu_desain',
  machine_id INT NULL,
  operator_id INT NULL,
  finishing_user_id INT NULL,
  waktu_mulai_cetak VARCHAR(40) NULL,
  waktu_selesai_cetak VARCHAR(40) NULL,
  klik_total INT NULL,
  estimasi_tinta_ml DECIMAL(10,2) NULL,
  batch_id INT NULL,
  satuan_hitung ENUM('pcs','klik') NOT NULL DEFAULT 'pcs',
  klik_per_lembar INT NOT NULL DEFAULT 1,
  ukuran_lembar VARCHAR(80) NULL,
  acc_admin_id INT NULL,
  waktu_acc VARCHAR(40) NULL,
  file_preview_acc VARCHAR(255) NULL,
  file_cetak_tiff VARCHAR(255) NULL,
  file_master_arsip VARCHAR(255) NULL,
  created_at VARCHAR(40) NOT NULL,
  updated_at VARCHAR(40) NOT NULL,
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES products(id),
  FOREIGN KEY (finishing_id) REFERENCES finishings(id) ON DELETE SET NULL,
  FOREIGN KEY (machine_id) REFERENCES print_machines(id) ON DELETE SET NULL,
  FOREIGN KEY (operator_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (finishing_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS supply_usages (
  id INT AUTO_INCREMENT PRIMARY KEY,
  supply_id INT NOT NULL,
  order_item_id INT NULL,
  jumlah DECIMAL(12,2) NOT NULL,
  satuan VARCHAR(20) NOT NULL,
  keterangan TEXT NULL,
  user_id INT NOT NULL,
  created_at VARCHAR(40) NOT NULL,
  FOREIGN KEY (supply_id) REFERENCES supplies(id) ON DELETE CASCADE,
  FOREIGN KEY (order_item_id) REFERENCES order_items(id) ON DELETE SET NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS print_batches (
  id INT AUTO_INCREMENT PRIMARY KEY,
  kode_batch VARCHAR(40) NOT NULL UNIQUE,
  machine_id INT NOT NULL,
  operator_id INT NOT NULL,
  item_ids JSON NOT NULL,
  lebar_gabungan_m DECIMAL(8,2) NOT NULL,
  panjang_tarik_m DECIMAL(8,2) NOT NULL,
  luas_terpakai_m2 DECIMAL(10,2) NOT NULL,
  luas_waste_m2 DECIMAL(10,2) NOT NULL,
  status ENUM('dihitung','diproses') NOT NULL DEFAULT 'dihitung',
  catatan TEXT NULL,
  created_at VARCHAR(40) NOT NULL,
  FOREIGN KEY (machine_id) REFERENCES print_machines(id),
  FOREIGN KEY (operator_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS order_payments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  order_id INT NOT NULL,
  tanggal VARCHAR(40) NOT NULL,
  nominal DECIMAL(12,2) NOT NULL,
  metode ENUM('Tunai','Transfer','QRIS') NOT NULL DEFAULT 'Tunai',
  keterangan VARCHAR(255) NULL,
  bukti_bayar VARCHAR(255) NULL,
  admin_id INT NOT NULL,
  shift_id INT NULL,
  created_at VARCHAR(40) NOT NULL,
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS design_revisions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  order_id INT NOT NULL,
  order_item_id INT NULL,
  revisi_ke INT NOT NULL,
  catatan_revisi TEXT NOT NULL,
  file_preview VARCHAR(255) NULL,
  admin_id INT NULL,
  status_revisi ENUM('menunggu','selesai') NULL,
  created_at VARCHAR(40) NOT NULL,
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS advertising_spks (
  id INT AUTO_INCREMENT PRIMARY KEY,
  order_id INT NOT NULL,
  jenis_pekerjaan VARCHAR(200) NOT NULL,
  ukuran_konstruksi VARCHAR(200) NOT NULL,
  lokasi_pasang TEXT NOT NULL,
  catatan_teknis TEXT NULL,
  status_lapangan ENUM('antrean','perakitan','pemasangan','selesai') NOT NULL DEFAULT 'antrean',
  created_at VARCHAR(40) NOT NULL,
  updated_at VARCHAR(40) NOT NULL,
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS material_logs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  order_item_id INT NOT NULL,
  material_roll_id INT NULL,
  material_offcut_id INT NULL,
  luas_netto_m2 DECIMAL(8,2) NOT NULL DEFAULT 0,
  wos_finishing_m2 DECIMAL(8,2) NOT NULL DEFAULT 0,
  wos_potong_m2 DECIMAL(8,2) NOT NULL DEFAULT 0,
  gagal_cetak_m2 DECIMAL(8,2) NOT NULL DEFAULT 0,
  keterangan VARCHAR(255) NULL,
  created_at VARCHAR(40) NOT NULL,
  FOREIGN KEY (order_item_id) REFERENCES order_items(id) ON DELETE CASCADE,
  FOREIGN KEY (material_roll_id) REFERENCES material_rolls(id) ON DELETE SET NULL,
  FOREIGN KEY (material_offcut_id) REFERENCES material_offcuts(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS operational_expenses (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tanggal DATE NOT NULL,
  kategori_biaya VARCHAR(100) NOT NULL,
  keterangan VARCHAR(255) NOT NULL,
  nominal DECIMAL(12,2) NOT NULL,
  created_at VARCHAR(40) NOT NULL
);

CREATE TABLE IF NOT EXISTS shifts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  kasir_id INT NOT NULL,
  opened_at VARCHAR(40) NOT NULL,
  closed_at VARCHAR(40) NULL,
  opening_cash DECIMAL(14,2) NOT NULL DEFAULT 0,
  expected_tunai DECIMAL(14,2) NOT NULL DEFAULT 0,
  expected_transfer DECIMAL(14,2) NOT NULL DEFAULT 0,
  expected_qris DECIMAL(14,2) NOT NULL DEFAULT 0,
  actual_tunai DECIMAL(14,2) NOT NULL DEFAULT 0,
  actual_transfer DECIMAL(14,2) NOT NULL DEFAULT 0,
  actual_qris DECIMAL(14,2) NOT NULL DEFAULT 0,
  selisih DECIMAL(14,2) NOT NULL DEFAULT 0,
  catatan TEXT NULL,
  status ENUM('buka','tutup') NOT NULL DEFAULT 'buka',
  FOREIGN KEY (kasir_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  user_name VARCHAR(100) NOT NULL,
  role VARCHAR(30) NOT NULL,
  action VARCHAR(80) NOT NULL,
  entity VARCHAR(80) NOT NULL,
  entity_id INT NULL,
  detail TEXT NULL,
  ip VARCHAR(64) NULL,
  created_at VARCHAR(40) NOT NULL
);

CREATE TABLE IF NOT EXISTS suppliers (
  id INT AUTO_INCREMENT PRIMARY KEY,
  kode_supplier VARCHAR(40) NOT NULL UNIQUE,
  nama_supplier VARCHAR(150) NOT NULL,
  kontak VARCHAR(100) NULL,
  no_wa VARCHAR(30) NULL,
  alamat TEXT NULL,
  npwp VARCHAR(40) NULL,
  aktif TINYINT(1) NOT NULL DEFAULT 1,
  created_at VARCHAR(40) NOT NULL,
  updated_at VARCHAR(40) NOT NULL
);

CREATE TABLE IF NOT EXISTS purchase_orders (
  id INT AUTO_INCREMENT PRIMARY KEY,
  no_po VARCHAR(30) NOT NULL UNIQUE,
  supplier_id INT NOT NULL,
  tanggal VARCHAR(40) NOT NULL,
  expected_at VARCHAR(40) NULL,
  status ENUM('draft','dikirim','diterima','batal') NOT NULL DEFAULT 'draft',
  catatan TEXT NULL,
  items_json LONGTEXT NOT NULL,
  total DECIMAL(14,2) NOT NULL DEFAULT 0,
  sudah_dibayar DECIMAL(14,2) NOT NULL DEFAULT 0,
  hutang DECIMAL(14,2) NOT NULL DEFAULT 0,
  diterima_at VARCHAR(40) NULL,
  created_at VARCHAR(40) NOT NULL,
  updated_at VARCHAR(40) NOT NULL,
  FOREIGN KEY (supplier_id) REFERENCES suppliers(id)
);

CREATE TABLE IF NOT EXISTS goods_receipts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  po_id INT NOT NULL,
  no_po VARCHAR(30) NOT NULL,
  tanggal VARCHAR(40) NOT NULL,
  admin_id INT NOT NULL,
  catatan TEXT NULL,
  created_at VARCHAR(40) NOT NULL,
  FOREIGN KEY (po_id) REFERENCES purchase_orders(id),
  FOREIGN KEY (admin_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS supplier_payments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  supplier_id INT NOT NULL,
  purchase_order_id INT NOT NULL,
  tanggal VARCHAR(40) NOT NULL,
  nominal DECIMAL(14,2) NOT NULL,
  metode ENUM('Tunai','Transfer','QRIS') NOT NULL DEFAULT 'Transfer',
  keterangan TEXT NULL,
  admin_id INT NOT NULL,
  created_at VARCHAR(40) NOT NULL,
  FOREIGN KEY (supplier_id) REFERENCES suppliers(id),
  FOREIGN KEY (purchase_order_id) REFERENCES purchase_orders(id),
  FOREIGN KEY (admin_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS whatsapp_outbox (
  id INT AUTO_INCREMENT PRIMARY KEY,
  event VARCHAR(40) NOT NULL,
  dedupe_key VARCHAR(120) NOT NULL UNIQUE,
  order_id INT NULL,
  no_wa VARCHAR(30) NOT NULL,
  pesan TEXT NOT NULL,
  link TEXT NULL,
  status ENUM('pending','terkirim','gagal') NOT NULL DEFAULT 'pending',
  attempts INT NOT NULL DEFAULT 0,
  last_error TEXT NULL,
  next_attempt_at VARCHAR(40) NULL,
  created_at VARCHAR(40) NOT NULL,
  updated_at VARCHAR(40) NOT NULL,
  sent_at VARCHAR(40) NULL
);

CREATE TABLE IF NOT EXISTS insentif_rates (
  id INT AUTO_INCREMENT PRIMARY KEY,
  role VARCHAR(30) NOT NULL,
  jenis VARCHAR(20) NOT NULL,
  nominal DECIMAL(14,2) NOT NULL DEFAULT 0,
  updated_at VARCHAR(40) NULL,
  updated_by INT NULL,
  UNIQUE KEY uq_insentif_role_jenis (role, jenis)
);

-- Indeks performa dibuat otomatis oleh MySqlAdapter.migrateSchema() agar aman
-- dijalankan berulang kali (CREATE INDEX IF NOT EXISTS tidak tersedia di semua MySQL).

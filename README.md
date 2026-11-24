<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://ai.google.dev/static/site-assets/images/share-ais-513315318.png" />
</div>

# Reffo PrintFlow

Aplikasi ERP digital printing: kasir/CRM, desain & ACC (Self-ACC + nota elektronik), produksi mesin,
finishing/QC, advertising, serah terima, stok bahan, serta laporan keuangan Owner.

## Menjalankan Lokal

**Prasyarat:** Node.js 20+ dan (opsional) MySQL 8.

1. Install dependencies: `npm install`
2. Salin `.env.example` menjadi `.env` (dibaca `dotenv/config`), isi `GEMINI_API_KEY` bila memakai fitur AI.
3. Jalankan: `npm run dev` lalu buka `http://localhost:3000`.
4. Cek tipe: `npm run lint`. Build produksi: `npm run build`.
5. Panduan lengkap instalasi dan pemakaian awal ada di [`PANDUAN.md`](./PANDUAN.md).
6. Dokumentasi sistem lengkap (fitur, fungsi, SOP per divisi, API, dan troubleshooting) tersedia dalam
   dua format: [`DOKUMENTASI_SISTEM.md`](./DOKUMENTASI_SISTEM.md) untuk GitHub dan
   [`DOKUMENTASI_SISTEM_REFFO_PRINTFLOW.docx`](./DOKUMENTASI_SISTEM_REFFO_PRINTFLOW.docx) untuk Word/PDF.

## Mode Penyimpanan

- `DB_DRIVER="json"` — default untuk preview/demo, data disimpan di `data/db.json`.
- `DB_DRIVER="mysql"` — produksi. Skema dibuat/dimigrasikan otomatis dari `database/schema.sql`
  saat server start. Gunakan database khusus, bukan database lain yang sudah dipakai.

## Konfigurasi Produksi (Go-Live)

Set di `.env` / environment server:

```env
NODE_ENV=production
DB_DRIVER=mysql
MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_USER=reffo_app
MYSQL_PASSWORD=password-kuat
MYSQL_DATABASE=reffo_printflow
SESSION_SECRET=string-acak-panjang-minimal-32-karakter
ENABLE_DEMO_SWITCH=false
MAX_UPLOAD_MB=20
KOMISI_PERSEN=1
APP_URL=https://printflow.domain.com

# Opsional: gateway WhatsApp. Jika kosong, pesan tetap antre (pending).
WHATSAPP_WEBHOOK_URL=https://gateway.domain.com/webhook/reffo
WHATSAPP_WEBHOOK_TOKEN=token-rahasia
AUTO_CLEAN_TIFF_HARI=90
```

Checklist singkat:

- [ ] `ENABLE_DEMO_SWITCH="false"` agar login cepat divisi tidak bisa dipakai.
- [ ] Ganti semua kata sandi seed (`password123`) melalui menu **Owner → Staf & Audit Log**.
- [ ] `SESSION_SECRET` unik dan rahasia; jangan commit `.env.local`.
- [ ] Folder `uploads/` di-backup dan di-serve hanya lewat aplikasi.
- [ ] Akses database dibatasi ke user aplikasi (`SELECT, INSERT, UPDATE, DELETE`).
- [ ] Pasang HTTPS/reverse proxy (Nginx/Caddy) di depan aplikasi.
- [ ] Uji alur: buat nota → self-ACC → ACC admin → cetak → finishing → serah terima → pelunasan.
- [ ] Uji void/refund, tutup shift kasir, dan export laporan Owner.
- [ ] Pastikan mesin aktif & mesin default produk sesuai kapasitas lebar/konsumsi tinta.
- [ ] Pastikan stok minimum tinta/bahan pembantu dan data restock sebelum go-live.
- [ ] Uji klik A3+, batch nesting 2–4 item, dan KPI produksi Owner.
- [ ] Uji alur Supplier → PO → Kirim → Terima (stok bertambah) → Bayar (hutang berkurang).
- [ ] Uji 4 event WhatsApp di menu **Owner → Integrasi & Pemeliharaan**; tanpa webhook status tetap `pending`.
- [ ] Uji tanda tangan digital saat serah terima dan pastikan bukti terverifikasi di audit log.
- [ ] Jalankan preview auto-clean TIFF sebelum menghapus; pastikan file master/preview tidak terhapus.

## Backup MySQL

Contoh backup harian (Linux/macOS, cron 02:00):

```bash
mkdir -p /var/backups/reffo
mysqldump --single-transaction --quick --routines --triggers \
  -u reffo_app -p reffo_printflow \
  | gzip > /var/backups/reffo/reffo-$(date +%F-%H%M).sql.gz
find /var/backups/reffo -name 'reffo-*.sql.gz' -mtime +30 -delete
```

Restore:

```bash
gunzip -c /var/backups/reffo/reffo-2026-01-31-0200.sql.gz | mysql -u reffo_app -p reffo_printflow
```

Backup `uploads/` bersamaan, misalnya `rsync -a uploads/ /var/backups/reffo/uploads/`.
Untuk mode JSON, cukup salin `data/db.json` + folder `uploads/` saat aplikasi berhenti.

## Peran & Alur Utama

| Peran | Tugas utama |
| --- | --- |
| Admin/Kasir | Buat nota, diskon/PPN/PPh23, pembayaran, void/reorder, shift kasir, serah terima |
| Desainer | Ambil desain, unggah preview, revisi, unggah TIFF final |
| Operator Cetak | Antrean per mesin, mulai/selesai cetak, klik A3+, estimasi tinta, batch nesting |
| Finishing | Antrean finishing, proses, QC, siap diambil, catat bahan pembantu |
| Advertising | SPK lapangan, foto, status pemasangan |
| Owner | Dashboard, rekap, stok, laba rugi, cashflow/piutang, KPI & insentif, profitabilitas produk/klien, supplier/PO/hutang, ekspor CSV, integrasi WhatsApp & pajak reklame, auto-clean TIFF, staf, audit log |

## Status Implementasi Roadmap

| Modul / Fitur | Status |
| --- | --- |
| A. Diskon item & nota, PPN/PPh 23, credit limit + jatuh tempo | Selesai |
| A. Void/refund (wajib alasan), reorder cepat, shift closing kasir | Selesai |
| B. Portal Self-ACC via token/QR/WhatsApp (bukti pesanan + nota elektronik) | Selesai |
| C–E. Antrean produksi/finishing & SPK advertising (alur existing) | Selesai (fondasi) |
| F/G/H. Cashflow, AR aging, margin, komisi, audit log, export CSV | Selesai (termasuk hutang dagang) |
| Infrastruktur. MySQL schema + index + `FOR UPDATE`, flag produksi, staff management, upload ketat, backup | Selesai |
| B. Checklist preflight CMYK/DPI/bleed & biaya jasa desain/revisi berbayar | Belum |
| B. Retensi otomatis & auto-clean file TIFF lama | Selesai |
| C. Master multi-mesin, antrean per mesin, batch nesting, klik A3+, estimasi tinta, KPI operator | Selesai |
| C. Master tinta & bahan pembantu, restock, finishing ID | Selesai |
| D. Sub-tahap finishing berantai & checklist QC fisik | Belum |
| E. Foto before/after + geo-tag, material SPK | Belum (fondasi SPK tersedia) |
| E. Reminder pajak reklame tahunan H-30 | Selesai |
| F. Supplier, PO, goods receipt & hutang dagang | Selesai (stock opname belum) |
| F. Stok tinta, suku cadang, dan bahan pembantu (master + pemakaian) | Selesai |
| G. Tanda tangan digital serah terima | Selesai (pelacakan kurir belum) |
| G. WhatsApp Gateway otomatis 4 event | Selesai (outbox + webhook env) |
| H. Analisis KPI lanjutan & insentif tim otomatis (tarif editable) | Selesai |
| H. Analisis profitabilitas per produk/klien | Selesai |
| H. Multi-cabang workshop | Tidak diimplementasikan (sesuai permintaan) |

Fitur yang masih "Belum" merupakan lanjutan Fase 2–4 pada blueprint
`.aistudio/artifacts/brain/.../rencana_pengembangan_erp_digital_printing.md`.

## Catatan Modul

- Pembayaran otomatis masuk ke shift kasir yang sedang terbuka. Tutup shift untuk rekonsiliasi
  tunai/transfer/QRIS dan catat selisih.
- PPh 23 dicatat sebagai pemotongan: `Total = DPP + PPN − PPh 23`, sehingga nilai tagihan sama
  dengan piutang bersih yang diterima.
- Link Self-ACC (`/acc/<token>`) dapat dibuka pelanggan tanpa login. Sebelum ACC, halaman menampilkan
  bukti pesanan (nama item, ukuran, finishing, qty, dan preview desain) tanpa harga; harga, diskon,
  DPP, PPN/PPh 23, total, DP, sisa tagihan, jatuh tempo, dan riwayat bayar baru dikirim dan tampil
  sebagai nota elektronik setelah persetujuan.
- Nota elektronik Self-ACC juga melampirkan hingga 10 nota lama milik pelanggan/instansi yang sama
  yang masih memiliki sisa tagihan, lengkap dengan total yang harus dibayar saat ini. Keputusan ACC
  bersifat final (POST ulang ditolak dengan HTTP 409); revisi dapat di-ACC ulang setelah desainer
  mengunggah preview baru. ACC internal Admin tetap wajib sebelum unggah TIFF dan antrean cetak.
- Produk A3+ memakai satuan hitung `klik`: `klik_total = qty × klik_per_lembar`. Nilai ini dihitung
  saat nota dibuat dan ditegaskan kembali saat Selesai Cetak.
- Batch nesting hanya menghitung lebar gabungan, panjang tarik, waste, dan penghematan, lalu
  membuat entitas `PrintBatch`. Stok roll belum dipotong sekali jalan; setiap item tetap melalui
  alur `Selesai Cetak` masing-masing.
- Pemakaian tinta dihitung dari luas cetak × `konsumsi_tinta_ml_per_mesin`, dipotong dari supply
  tinta yang sesuai jenis mesin. Bahan pembantu finishing dicatat saat konfirmasi finishing.
- Alur Purchasing: `draft → dikirim → diterima → bayar`. Penerimaan menambah stok roll/supply/produk
  dan mencatat hutang; pembayaran mengurangi hutang PO. Aging hutang tampil di laporan keuangan Owner.
- Ekspor laporan memakai CSV dengan BOM UTF-8 (Excel-friendly). Tidak ada dependency XLSX tambahan.
- WhatsApp Gateway bersifat best-effort: lima event (`nota_dibuat`, `preview_siap_acc`,
  `siap_diambil`, `piutang_jatuh_tempo`, `pajak_reklame_jatuh_tempo`) masuk ke `whatsapp_outbox`.
  Tanpa `WHATSAPP_WEBHOOK_URL`, status tetap `pending` dan bisa dicoba ulang dari menu Integrasi.
  Dedupe key mencegah pengiriman ganda untuk event yang sama.
- Insentif dihitung otomatis per staf aktif: item selesai × tarif item + nota/job selesai × tarif
  nota per divisi (desainer, operator cetak, finishing). Tarif default bisa diubah Owner di menu
  **KPI & Insentif Tim**; setiap perubahan tercatat di audit log.
- Pajak reklame disimpan per instansi sebagai `pajak_reklame_expired` (`YYYY-MM-DD`). Sistem
  menghitung jatuh tempo tahunan berikutnya dan menyiapkan pengingat H-30 (atau sesuai jendela
  `PAJAK_REKLAME_HARI`) dengan dedupe per instansi dan tahun. Nomor WA diambil dari PIC instansi.
- Analisis profitabilitas memakai omzet item (`subtotal`) dikurangi HPP master produk (`harga_modal`,
  dengan basis luas untuk produk meteran dan qty untuk produk satuan). Tersedia per produk dan per
  instansi/klien, termasuk ekspor CSV terpisah.
- Auto-clean TIFF hanya menghapus `file_cetak_tiff` yang terverifikasi di folder `uploads/` pada nota
  selesai yang sudah lewat retensi (default 90 hari). `file_master_arsip` dan `file_preview_acc`
  tidak pernah dihapus. Selalu jalankan **Preview** sebelum **Jalankan**.
- Tanda tangan pengambil disimpan sebagai data URL PNG/JPG pada nota; wajib lunas dan seluruh item
  `siap_diambil` sebelum serah terima diproses.

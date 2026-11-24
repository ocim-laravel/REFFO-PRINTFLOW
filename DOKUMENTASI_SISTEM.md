# Reffo PrintFlow — Dokumentasi Sistem & Panduan Operasional
Penjelasan fungsi, fitur, alur kerja, dan tugas setiap divisi

| Informasi | Keterangan |
| --- | --- |
| Versi dokumen | 1.0 |
| Tanggal | 25 November 2026 |
| Mode penyimpanan | JSON (preview) dan MySQL/MariaDB (produksi) |
| Pengguna internal | Owner, Admin/Kasir, Desainer, Operator Cetak, Finishing, Advertising |
| Pengguna eksternal | Pelanggan melalui portal Self-ACC berbasis token/QR |
| Status multi-cabang | Tidak diimplementasikan sesuai permintaan |

> **Dokumen ini menjelaskan kondisi sistem saat ini. Fitur yang masih berstatus 'Belum' disebut sebagai rencana dan belum tersedia di aplikasi.**


## Daftar Isi

- 1. Ringkasan Sistem
- 2. Instalasi, Konfigurasi, dan Backup
- 3. Peran, Hak Akses, dan Menu per Divisi
- 4. Daftar Fitur dan Fungsi per Modul
- 5. Alur Kerja End-to-End dan SOP per Divisi
- 6. Status Data dan Istilah Operasional
- 7. Aturan dan Perhitungan Bisnis
- 8. Struktur Data Utama
- 9. Ringkasan API dan Integrasi
- 10. Keamanan, Audit, dan Catatan Operasional
- 11. Troubleshooting
- 12. Lampiran Checklist

## 1. Ringkasan Sistem

Reffo PrintFlow adalah aplikasi ERP berbasis web untuk usaha digital printing. Aplikasi mengelola seluruh siklus pesanan: pembuatan nota oleh kasir, persetujuan desain oleh pelanggan (Self-ACC) dan admin, produksi cetak, finishing/QC, SPK advertising, serah terima barang, pembayaran, stok bahan, pembelian, serta laporan keuangan dan KPI untuk Owner.


### 1.1 Arsitektur Singkat

| Komponen | Penjelasan |
| --- | --- |
| Frontend | React 19 + Vite + Tailwind CSS. Antarmuka responsif, termasuk halaman publik Self-ACC. |
| Backend | Express + TypeScript. Endpoint REST, autentikasi berbasis token, SSE untuk pembaruan status. |
| Penyimpanan | Mode JSON (data/db.json) untuk preview; mode MySQL/MariaDB untuk produksi dengan skema dan migrasi otomatis. |
| File | Folder uploads/ menyimpan preview desain, TIFF, lampiran briefing, bukti bayar, foto serah terima, dan tanda tangan. |
| Notifikasi | WhatsApp outbox dengan dedupe dan retry ke webhook gateway bila dikonfigurasi. |
| Akses publik | Halaman /acc/<token> dapat dibuka pelanggan tanpa login untuk ACC dan melihat nota elektronik. |


### 1.2 Cakupan dan Batasan

- Tersedia untuk satu workshop dengan enam peran internal dan portal pelanggan.
- Multi-cabang workshop tidak diimplementasikan sesuai permintaan.
- Checklist preflight CMYK/DPI/bleed dan biaya jasa desain/revisi berbayar belum tersedia.
- Sub-tahap finishing berantai dan checklist QC fisik belum tersedia; alur antrean finishing existing sudah berjalan.
- Foto before/after dan geo-tag untuk SPK lapangan belum tersedia; fondasi SPK sudah ada.
- Stock opname dan pelacakan kurir belum tersedia.

### 1.3 Status Implementasi Fitur

| Fitur | Status |
| --- | --- |
| Diskon item & nota, PPN/PPh 23, batas kredit, jatuh tempo | Selesai |
| Void/refund dengan alasan, reorder cepat, shift closing kasir | Selesai |
| Portal Self-ACC via token/QR/WhatsApp + nota elektronik | Selesai |
| Antrean desain, cetak, finishing, dan SPK advertising | Selesai (fondasi) |
| Master multi-mesin, antrean per mesin, batch nesting, klik A3+, estimasi tinta, KPI operator | Selesai |
| Master tinta & bahan pembantu, restock, finishing ID | Selesai |
| Reminder pajak reklame tahunan H-30 | Selesai |
| Supplier, PO, goods receipt, hutang dagang | Selesai (stock opname belum) |
| Tanda tangan digital serah terima | Selesai (kurir belum) |
| WhatsApp gateway 5 event dengan outbox | Selesai |
| KPI lanjutan & insentif tim otomatis | Selesai |
| Analisis profitabilitas per produk/klien | Selesai |
| Retensi & auto-clean TIFF | Selesai |
| Multi-cabang workshop | Tidak diimplementasikan |


## 2. Instalasi, Konfigurasi, dan Backup


### 2.1 Prasyarat

| Kebutuhan | Keterangan |
| --- | --- |
| Node.js | Versi 20 ke atas; disarankan 22 LTS. |
| npm | Sudah termasuk saat memasang Node.js. |
| Browser | Chrome atau Edge terbaru. |
| MySQL/MariaDB | Opsional. MariaDB 10.x / MySQL 8.x; XAMPP mendukung. |
| Port | Default 3000. Dapat diganti lewat variabel PORT. |


### 2.2 Langkah Instalasi


```powershell
cd "D:\NURROKHIM STL\PROJECT\reffo-printflow"
```


```powershell
npm install
```


```powershell
Copy-Item .env.example .env
```


```powershell
npm run lint
```


```powershell
npm run build
```


```powershell
npm run dev
```

Setelah server berjalan, buka http://localhost:3000. Untuk produksi, gunakan NODE_ENV=production dan node server.js.


### 2.3 Variabel Environment

| Variabel | Default | Fungsi |
| --- | --- | --- |
| NODE_ENV | development | Menandakan mode produksi; memengaruhi perilaku session dan flag tertentu. |
| PORT | 3000 | Port server Express. |
| DB_DRIVER | json | json = data/db.json; mysql = MySQL/MariaDB dengan transaksi. |
| MYSQL_HOST / PORT | 127.0.0.1 / 3306 | Alamat server database. |
| MYSQL_USER / PASSWORD | root / kosong | Kredensial database. Untuk produksi gunakan user khusus. |
| MYSQL_DATABASE | reffo_printflow | Nama database. Skema dibuat/dimigrasikan otomatis. |
| SESSION_SECRET | auto di dev | Kunci penandatanganan token sesi. Wajib diganti saat produksi. |
| ENABLE_DEMO_SWITCH | false (dari .env) | true = login cepat/ganti akun aktif; false = wajib email & password. Bila variabel tidak diatur, kode memakai true. |
| APP_URL | - | Base URL untuk link absolut pada pesan WhatsApp dan QR Self-ACC. |
| MAX_UPLOAD_MB | 20 | Batas ukuran unggahan desain, bukti bayar, dan lampiran. |
| KOMISI_PERSEN | 1 | Persentase komisi admin pada laporan Owner. |
| WHATSAPP_WEBHOOK_URL | kosong | Endpoint gateway WhatsApp. Jika kosong, pesan tetap pending di outbox. |
| WHATSAPP_WEBHOOK_TOKEN | kosong | Token bearer untuk gateway WhatsApp. |
| PAJAK_REKLAME_HARI | 30 | Jendela pengingat pajak reklame tahunan (default H-30). |
| AUTO_CLEAN_TIFF_HARI | 90 | Retensi file TIFF sebelum auto-clean. |
| GEMINI_API_KEY | - | Dibutuhkan bila memakai fitur AI. |

> **Sebelum go-live: ENABLE_DEMO_SWITCH=false, SESSION_SECRET unik, semua password seed diganti, HTTPS/reverse proxy aktif, dan backup dijadwalkan.**


### 2.4 Akun Awal

Semua akun awal memakai password password123. Segera ganti melalui Owner → Staf & Audit Log.

| Nama | Email | Peran |
| --- | --- | --- |
| Pak Hendra | owner@reffoprint.id | Owner / Direktur |
| Rina | admin@reffoprint.id | Admin / Kasir |
| Budi | desainer@reffoprint.id | Desainer Grafis |
| Agus | operator@reffoprint.id | Operator Cetak |
| Dedi | finishing@reffoprint.id | Divisi Finishing |
| Eko | advertising@reffoprint.id | Tim Advertising |


### 2.5 Backup dan Restore


#### Mode JSON


```powershell
Copy-Item data\db.json "C:\backup\reffo-db-$(Get-Date -Format yyyyMMdd).json"
```


```powershell
Copy-Item "C:\backup\reffo-db-YYYYMMDD.json" data\db.json -Force
```

Matikan server sebelum restore agar file tidak ditulis ulang. Sertakan folder uploads/ dalam backup.


#### Mode MySQL


```powershell
& "C:\xampp\mysql\bin\mysqldump.exe" -u reffo_app -p reffo_printflow > "C:\backup\reffo-$(Get-Date -Format yyyyMMdd).sql"
```


```powershell
& "C:\xampp\mysql\bin\mysql.exe" -u reffo_app -p reffo_printflow < "C:\backup\reffo-YYYYMMDD.sql"
```

Untuk lingkungan Linux, gunakan mysqldump --single-transaction dan simpan juga folder uploads/.


## 3. Peran, Hak Akses, dan Menu per Divisi

| Peran | Email seed | Menu utama | Fokus tanggung jawab |
| --- | --- | --- | --- |
| Owner / Direktur | owner@reffoprint.id | Ringkasan Workshop, Rekap Semua Nota, Stok & Audit Bahan, Laporan Laba Rugi, Cashflow & Piutang, Supplier & Purchase Order, KPI Produksi, KPI & Insentif Tim, Analisis Profitabilitas, Integrasi & Pemeliharaan, Staf & Audit Log, Pengaturan Master | Menyiapkan master, mengawasi keuangan/KPI, mengelola tarif insentif, pajak reklame, integrasi, staf, dan backup. |
| Admin / Kasir | admin@reffoprint.id | Daftar Nota & Order, Review Desain (ACC), Shift & Tutup Kasir, Serah Terima Barang | Membuat nota, menerima pembayaran, ACC desain internal, mengelola shift, void/reorder, dan serah terima. |
| Desainer Grafis | desainer@reffoprint.id | Antrean Desain, Serah Terima Barang, Riwayat Selesai | Menerima job, mengunggah preview, menangani revisi, mengunggah TIFF final, dan memfinalisasi master. |
| Operator Cetak | operator@reffoprint.id | Antrean Cetak, Serah Terima Barang, Riwayat Selesai | Memilih mesin, menjalankan cetak, mencatat klik A3+, estimasi tinta, batch nesting, dan selesai cetak. |
| Divisi Finishing | finishing@reffoprint.id | Antrean Finishing, Serah Terima Barang, Riwayat Selesai | Memproses finishing, mencatat bahan pembantu, QC, dan menyiapkan barang siap diambil. |
| Tim Advertising | advertising@reffoprint.id | SPK Lapangan, Serah Terima Barang, Riwayat Selesai | Mengelola SPK lapangan, ukuran konstruksi, lokasi pasang, dan status pemasangan. |
| Pelanggan | Tanpa login | Portal /acc/<token> | Melihat bukti pesanan & preview, menyetujui atau meminta revisi, menerima nota elektronik. |

> **ACC pelanggan di portal Self-ACC tidak menggantikan ACC internal Admin. Item baru masuk antrean cetak/TIFF setelah Admin menyetujui di menu Review Desain (ACC).**


## 4. Daftar Fitur dan Fungsi per Modul


### 4.1 Kasir, CRM, dan Pembayaran

| Fitur | Fungsi | Pengguna | Hasil |
| --- | --- | --- | --- |
| Buat Nota Baru | Pilih instansi/pelanggan, kategori harga, item, ukuran, finishing, qty, diskon item, diskon nota, PPN, PPh 23, DP, jatuh tempo, dan Self-ACC. | Admin/Kasir | Nota aktif dengan nomor otomatis, token Self-ACC, dan item siap desain. |
| Harga 4 Tier | Harga satuan otomatis mengikuti kategori: umum, reseller, prioritas, pegawai. | Admin/Kasir, Owner | Harga jual konsisten dengan master produk. |
| Batas Kredit | Mencegah nota baru bila piutang aktif + nilai nota melebihi credit_limit instansi; dapat di-override. | Admin/Kasir, Owner | Pengendalian piutang. |
| Pembayaran & DP | Catat DP atau pelunasan, metode Tunai/Transfer/QRIS, bukti bayar, dan keterangan. | Admin/Kasir | Status bayar belum_lunas/dp/lunas serta riwayat pembayaran. |
| Shift Kasir | Buka shift, catat transaksi, tutup shift, dan rekonsiliasi selisih tunai/transfer/QRIS. | Admin/Kasir | Rekap kas harian. |
| Void / Refund | Membatalkan nota dengan alasan wajib untuk audit. | Admin/Kasir, Owner | Nota berstatus batal; piutang tidak dihitung. |
| Reorder Cepat | Membuat nota baru dari nota sebelumnya dengan token Self-ACC baru. | Admin/Kasir | Pengulangan pesanan lebih cepat. |
| Serah Terima | Serahkan barang dengan tanda tangan digital, foto, dan nama pengambil. | Admin/Kasir dan divisi terkait | Bukti serah terima tersimpan di nota. |
| Cetak & Kirim WA | Cetak/simpan PDF nota dan kirim ringkasan pesanan lewat WhatsApp. | Admin/Kasir | Pelanggan menerima detail pesanan dan link Self-ACC. |


### 4.2 Portal Self-ACC dan Nota Elektronik

| Fitur | Fungsi | Pengguna | Hasil |
| --- | --- | --- | --- |
| Link/QR Self-ACC | Token acak 36 karakter dibuat otomatis saat nota dibuat; link /acc/<token> dibagikan lewat QR atau WhatsApp. | Admin/Kasir, Pelanggan | Akses publik tanpa login. |
| Bukti Pesanan | Menampilkan nama item, ukuran, luas, finishing, qty, catatan desain, lampiran briefing, dan preview desain. | Pelanggan | Pelanggan memverifikasi pesanan sebelum ACC. |
| Harga Tersembunyi | Sebelum ACC, data finansial tidak dikirim API dan tidak tampil di UI. | Pelanggan | Harga hanya dibuka setelah konfirmasi. |
| Persetujuan / Revisi | Pelanggan menyetujui atau meminta revisi dengan catatan wajib. | Pelanggan | approval_status menunggu → disetujui/revisi. |
| Nota Elektronik | Setelah ACC, harga satuan, subtotal, diskon, DPP, PPN, PPh 23, total, DP, sisa, jatuh tempo, dan riwayat bayar muncul otomatis. | Pelanggan | Bukti tagihan yang bisa dicetak/di-PDF. |
| Lampiran Tagihan Lama | Hingga 10 nota lain dengan pelanggan/instansi sama yang masih punya sisa tagihan, lengkap dengan total harus dibayar. | Pelanggan | Tagihan lama tidak terlewat. |
| Guard ACC Final | POST persetujuan kedua ditolak HTTP 409. | Sistem | Keputusan tidak dapat diubah sembarangan. |
| ACC Ulang Setelah Revisi | Upload preview baru oleh desainer mengembalikan status ke menunggu dan menghapus catatan revisi. | Desainer, Pelanggan | Pelanggan dapat ACC ulang. |


### 4.3 Desain dan Review ACC

| Fitur | Fungsi | Pengguna | Hasil |
| --- | --- | --- | --- |
| Antrean Desain | Menampilkan nota dengan item menunggu desain/proses/revisi. | Desainer | Daftar job yang harus dikerjakan. |
| Terima Job | Menandai desainer dan waktu terima; item menjadi proses_desain. | Desainer | Kepemilikan job jelas. |
| Upload Preview | Mengunggah gambar preview untuk ACC pelanggan; WA preview_siap_acc dikirim. | Desainer | Item menjadi menunggu_acc dan link ACC dikirim. |
| Revisi Desain | Catatan pelanggan/create revisi tercatat; desainer mengunggah preview terbaru. | Pelanggan, Desainer | Riwayat revisi tersimpan. |
| Review Desain (ACC) | Admin menyetujui atau meminta revisi desain internal. | Admin/Kasir | ACC internal sebelum TIFF/cetak. |
| Upload TIFF | Desainer mengunggah TIFF final setelah ACC internal. | Desainer | Item siap masuk antrean cetak. |
| Master Arsip | Finalisasi master bila seluruh item memiliki TIFF. | Desainer | Item masuk antrean cetak. |


### 4.4 Produksi Cetak

| Fitur | Fungsi | Pengguna | Hasil |
| --- | --- | --- | --- |
| Antrean per Mesin | Menampilkan item antrean_cetak berdasarkan mesin default/urutan mesin. | Operator Cetak | Penjadwalan cetak per mesin. |
| Mulai / Selesai Cetak | Mencatat waktu mulai dan selesai; status item naik ke antrean finishing. | Operator Cetak | Progres produksi tercatat. |
| Klik A3+ | Mencatat klik_total = qty × klik_per_lembar untuk produk ber-satuan klik. | Operator Cetak | Dasar penagihan dan KPI. |
| Estimasi Tinta | Menghitung pemakaian tinta dari luas cetak × konsumsi mesin dan memotong stok supply. | Sistem, Operator | Stok tinta berkurang otomatis. |
| Batch Nesting | Menghitung lebar gabungan, panjang tarik, waste, dan penghematan untuk beberapa item. | Operator Cetak | Entitas PrintBatch untuk optimasi. |
| KPI Operator | Rekap item selesai, mesin, dan performa produksi. | Owner | Dasar insentif operator. |


### 4.5 Finishing dan QC

| Fitur | Fungsi | Pengguna | Hasil |
| --- | --- | --- | --- |
| Antrean Finishing | Menampilkan item yang selesai cetak. | Finishing | Daftar pekerjaan finishing. |
| Proses Finishing | Mencatat waktu proses dan status proses_finishing. | Finishing | Progres tercatat. |
| Bahan Pembantu | Mencatat supply yang dipakai saat finishing. | Finishing | Stok berkurang dan biaya tercatat. |
| Siap Diambil | Menandai item selesai QC dan siap diambil pelanggan. | Finishing | Status siap_diambil. |
| Serah Terima | Menyerahkan barang dengan tanda tangan dan foto. | Finishing/Admin | Bukti serah terima. |


### 4.6 Advertising / SPK Lapangan

| Fitur | Fungsi | Pengguna | Hasil |
| --- | --- | --- | --- |
| SPK Lapangan | Membuat/melihat SPK dari nota yang memerlukan pekerjaan lapangan. | Advertising | SPK dengan jenis pekerjaan, ukuran, lokasi, dan catatan teknis. |
| Status Lapangan | Mengubah status antrean → perakitan → pemasangan → selesai. | Advertising | Progres pemasangan terpantau. |
| Serah Terima & Riwayat | Melihat serah terima dan riwayat nota terkait. | Advertising | Akurasi pekerjaan lapangan. |


### 4.7 Stok, Supplier, dan Purchasing

| Fitur | Fungsi | Pengguna | Hasil |
| --- | --- | --- | --- |
| Master Roll & Supply | Menambah roll bahan, tinta, bahan finishing, stok minimum, dan harga satuan. | Owner | Master stok siap dipakai produksi. |
| Restock Produk | Menambah stok produk satuan (pcs). | Owner | Stok produk tersedia. |
| Master Mesin | Menambah mesin, konsumsi tinta per m², dan urutan antrean. | Owner | Antrean cetak dan estimasi tinta berfungsi. |
| Supplier & PO | Alur draft → dikirim → diterima → bayar. | Owner | Penerimaan menambah stok & hutang; pembayaran mengurangi hutang. |
| Stok & Audit Bahan | Mutasi material roll, offcut, supply, dan pemakaian. | Owner | Jejak stok untuk audit. |


### 4.8 Laporan dan Analisis Owner

| Fitur | Fungsi | Pengguna | Hasil |
| --- | --- | --- | --- |
| Ringkasan Workshop | Dashboard status nota, produksi, stok minimum, dan aktivitas tim. | Owner | Pantauan cepat. |
| Rekap Semua Nota | Daftar dan filter seluruh nota dengan nominal, status bayar, dan ACC. | Owner | Audit pesanan. |
| Laporan Laba Rugi | Omzet, HPP, laba kotor, biaya operasional, dan komisi. | Owner | Kinerja keuangan. |
| Cashflow & Piutang | Arus kas, aging piutang, dan pengingat jatuh tempo. | Owner | Kontrol piutang. |
| KPI Produksi | Performa mesin dan operator. | Owner | Dasar penilaian produksi. |
| KPI & Insentif Tim | Insentif otomatis per staf aktif; tarif dapat diubah. | Owner | Perhitungan insentif transparan. |
| Analisis Profitabilitas | Laba kotor per produk dan per instansi/klien. | Owner | Keputusan harga dan pelanggan. |
| Ekspor CSV | Ekspor laporan dengan delimiter ;, quoting ganda, CRLF, BOM UTF-8. | Owner | Kompatibel dengan Excel. |
| Staf & Audit Log | Kelola akun, reset password, nonaktifkan staf, lihat jejak perubahan. | Owner | Keamanan dan akuntabilitas. |


### 4.9 Integrasi & Pemeliharaan

| Fitur | Fungsi | Pengguna | Hasil |
| --- | --- | --- | --- |
| WhatsApp Outbox | Lima event: nota_dibuat, preview_siap_acc, siap_diambil, piutang_jatuh_tempo, pajak_reklame_jatuh_tempo. | Sistem, Owner | Pesan antre dengan dedupe; retry otomatis 3 kali. |
| Gateway WA | Kirim outbox ke WHATSAPP_WEBHOOK_URL bila dikonfigurasi. | Owner | Notifikasi otomatis ke pelanggan. |
| Pajak Reklame | Simpan tanggal expired per instansi; pengingat tahunan H-30 dengan dedupe per instansi/tahun. | Owner | Tidak ada pajak terlewat. |
| Auto-clean TIFF | Preview file TIFF pada nota selesai yang lewat retensi; hapus hanya file terverifikasi. | Owner | Folder uploads tetap terkendali. |
| Integrasi & Pemeliharaan | Mengelola webhook, pengingat, dan retry outbox. | Owner | Kontrol integrasi. |


## 5. Alur Kerja End-to-End dan SOP per Divisi


### 5.1 Alur End-to-End Ringkas

1. Owner menyiapkan master data: produk, harga, mesin, roll, supply, supplier, tarif insentif, dan pajak reklame.
2. Admin/Kasir membuka shift, membuat nota, menerima DP, dan membagikan link/QR Self-ACC.
3. Pelanggan membuka link Self-ACC, memeriksa bukti pesanan dan preview, lalu menyetujui atau meminta revisi.
4. Desainer mengerjakan desain, mengunggah preview, mengikuti revisi, lalu menunggu ACC internal Admin.
5. Admin menyetujui desain internal; Desainer mengunggah TIFF dan memfinalisasi master.
6. Operator Cetak mengambil item, menjalankan cetak, mencatat klik/estimasi tinta, lalu menyelesaikan cetak.
7. Finishing memproses item, mencatat bahan, melakukan QC, dan menandai siap diambil.
8. Admin menerima pelunasan dan melakukan serah terima dengan tanda tangan/foto.
9. Admin menutup shift; Owner memeriksa laporan, KPI, insentif, piutang, dan integrasi.

### 5.2 SOP Admin / Kasir

| Langkah | Aksi di Aplikasi | Output | Catatan |
| --- | --- | --- | --- |
| 1 | Buka menu Shift & Tutup Kasir → Buka shift. | Shift aktif | Semua pembayaran tercatat di shift ini. |
| 2 | Daftar Nota & Order → Buat Nota Baru. | Nota aktif + token ACC | Isi item, ukuran, finishing, diskon, PPN/PPh23, DP, jatuh tempo. |
| 3 | Cetak nota atau salin link Self-ACC / QR, lalu kirim ke pelanggan. | Link /acc/<token> terkirim | Event WhatsApp nota_dibuat masuk outbox. |
| 4 | Pantau status ACC pelanggan. Bila revisi, teruskan catatan ke desainer. | Status ACC terpantau | ACC pelanggan belum memasukkan item ke cetak. |
| 5 | Review Desain (ACC) → Setujui setelah desain siap. | ACC internal selesai | Desainer baru bisa upload TIFF setelah ini. |
| 6 | Terima DP/pelunasan; unggah bukti bayar bila ada. | Riwayat pembayaran | Status bayar berubah dp/lunas. |
| 7 | Serah Terima Barang → isi pengambil, tanda tangan, foto. | Bukti serah terima | Syarat: lunas dan semua item siap_diambil. |
| 8 | Tutup shift dan cek selisih kas. | Rekap shift | Selisih tercatat untuk audit. |


### 5.3 SOP Pelanggan (Self-ACC)

| Langkah | Aksi di Portal | Output | Catatan |
| --- | --- | --- | --- |
| 1 | Buka link /acc/<token> dari QR/WhatsApp. | Halaman Self-ACC | Tanpa login. |
| 2 | Periksa item, ukuran, finishing, qty, catatan, dan preview. | Bukti pesanan terverifikasi | Sebelum ACC, harga belum ditampilkan. |
| 3 | Isi nama PIC opsional; pilih Setujui & Tampilkan Nota atau Minta Revisi. | Keputusan ACC | Revisi wajib catatan. |
| 4 | Setelah ACC, lihat nota elektronik dan cetak/simpan PDF. | Nota elektronik | Harga, total, DP, sisa, jatuh tempo, riwayat bayar muncul. |
| 5 | Periksa lampiran tagihan lama dan total yang harus dibayar. | Ringkasan tagihan | Maksimal 10 nota lama belum lunas. |
| 6 | Jika revisi, tunggu preview baru lalu ACC ulang. | ACC ulang | Status kembali menunggu setelah desainer upload preview. |


### 5.4 SOP Desainer Grafis

| Langkah | Aksi di Aplikasi | Output | Catatan |
| --- | --- | --- | --- |
| 1 | Antrean Desain → ambil job. | Item proses_desain | Job menjadi milik desainer. |
| 2 | Siapkan desain dan unggah preview. | Preview ACC | WA preview_siap_acc terkirim. |
| 3 | Pantau ACC pelanggan. Jika revisi, perbaiki dan unggah preview baru. | Status ACC kembali menunggu | Catatan revisi lama dihapus otomatis. |
| 4 | Setelah Admin ACC internal, unggah file TIFF final per item. | file_cetak_tiff | Wajib ACC internal Admin. |
| 5 | Finalisasi master bila semua item bertanda SIAP_CETAK_TIFF. | Item antrean_cetak | Item masuk antrean operator. |
| 6 | Cek Riwayat Selesai untuk arsip pekerjaan. | Arsip desain | Preview tidak pernah dihapus auto-clean. |


### 5.5 SOP Operator Cetak

| Langkah | Aksi di Aplikasi | Output | Catatan |
| --- | --- | --- | --- |
| 1 | Antrean Cetak → pilih mesin dan mulai cetak. | Item proses_cetak | Waktu mulai tercatat. |
| 2 | Catat klik untuk produk A3+. | klik_total | qty × klik_per_lembar. |
| 3 | Gunakan Batch Nesting bila beberapa item dapat digabung. | PrintBatch | Lebar gabungan, waste, penghematan dihitung. |
| 4 | Pastikan estimasi tinta/supply tercatat dan stok mencukupi. | Stok tinta berkurang | Berdasarkan konsumsi mesin per m². |
| 5 | Klik Selesai Cetak. | Item antrean_finishing | Item diteruskan ke finishing. |


### 5.6 SOP Divisi Finishing

| Langkah | Aksi di Aplikasi | Output | Catatan |
| --- | --- | --- | --- |
| 1 | Antrean Finishing → proses item. | Item proses_finishing | Waktu proses tercatat. |
| 2 | Catat bahan pembantu yang dipakai. | Pemakaian supply | Stok berkurang. |
| 3 | Lakukan QC fisik dan tandai Siap Diambil. | Item siap_diambil | Sub-tahap QC berantai belum tersedia. |
| 4 | Bantu serah terima bila diminta. | Bukti serah terima | Tanda tangan dan foto wajib. |


### 5.7 SOP Tim Advertising

| Langkah | Aksi di Aplikasi | Output | Catatan |
| --- | --- | --- | --- |
| 1 | SPK Lapangan → buka SPK dari nota terkait. | SPK aktif | Isi jenis pekerjaan, ukuran, lokasi, catatan teknis. |
| 2 | Update status antrean → perakitan → pemasangan → selesai. | Progres lapangan | Status terpantau Owner. |
| 3 | Cek serah terima dan riwayat bila diperlukan. | Data pendukung | Foto geo-tag belum tersedia. |


### 5.8 SOP Owner

| Langkah | Aksi di Aplikasi | Output | Catatan |
| --- | --- | --- | --- |
| 1 | Pengaturan Master → isi produk, harga 4 tier, HPP, mesin, roll, supply, dan stok minimum. | Master data siap | Dilakukan sebelum operasional. |
| 2 | Supplier & Purchase Order → kelola supplier, PO, penerimaan, dan pembayaran. | Stok & hutang terkendali | Penerimaan menambah stok & hutang. |
| 3 | KPI & Insentif Tim → cek/ubah tarif. | Tarif insentif | Perubahan tercatat di audit. |
| 4 | Integrasi & Pemeliharaan → isi pajak reklame, webhook WA, retry outbox, auto-clean TIFF. | Integrasi aktif | Tanpa webhook, pesan tetap pending. |
| 5 | Staf & Audit Log → ganti password seed, kelola staf. | Akun aman | Demo switch false saat produksi. |
| 6 | Akhir hari: cek Ringkasan Workshop, Cashflow & Piutang, Laba Rugi, KPI, Profitabilitas, dan ekspor CSV. | Keputusan bisnis | CSV memakai BOM UTF-8, delimiter ;, CRLF. |
| 7 | Lakukan backup database dan uploads sesuai jadwal. | Backup tersedia | Matikan server saat restore JSON. |


## 6. Status Data dan Istilah Operasional

| Jenis status | Nilai | Arti |
| --- | --- | --- |
| Status nota | aktif | Nota berjalan normal. |
| Status nota | batal | Nota dibatalkan/void; alasan wajib dan tidak masuk piutang. |
| Status bayar | belum_lunas | Belum ada pembayaran; sisa = total tagihan. |
| Status bayar | dp | Sebagian sudah dibayar; sisa = total − DP. |
| Status bayar | lunas | DP/pelunasan = total tagihan; sisa = 0. |
| Status ACC | belum | Belum ada token/pengajuan ACC. |
| Status ACC | menunggu | Menunggu keputusan pelanggan. |
| Status ACC | disetujui | Pelanggan menyetujui; nota elektronik tampil; keputusan final. |
| Status ACC | revisi | Pelanggan meminta revisi; ACC ulang setelah preview baru. |
| Status desain | belum_ada_file / file_mentah / coretan_kertas / siap_cetak_tiff | Jenis materi desain awal. |
| Status produksi | menunggu_desain | Item belum diambil desainer. |
| Status produksi | proses_desain | Desainer sedang mengerjakan. |
| Status produksi | menunggu_acc | Preview menunggu ACC; bisa ACC pelanggan/admin. |
| Status produksi | revisi | Perlu perbaikan desain. |
| Status produksi | antrean_cetak / proses_cetak | Menunggu atau sedang dicetak. |
| Status produksi | antrean_finishing / proses_finishing | Menunggu atau sedang finishing. |
| Status produksi | siap_diambil | QC selesai, siap diserahkan. |
| Status produksi | selesai | Item selesai. |
| Status SPK | antrean / perakitan / pemasangan / selesai | Progres pekerjaan lapangan. |
| Status PO | draft / dikirim / diterima / bayar | Progres pembelian. |


## 7. Aturan dan Perhitungan Bisnis

| Aturan | Rumus / Penjelasan |
| --- | --- |
| Harga satuan | Mengikuti kategori pelanggan: umum → harga_umum, reseller → harga_reseller, prioritas → harga_prioritas, pegawai → harga_pegawai. |
| Produk meteran | luas_tagihan = lebar_m × tinggi_m × qty; harga sebelum diskon = harga_satuan × luas_tagihan. |
| Produk satuan | harga sebelum diskon = harga_satuan × qty; klik_total = qty × klik_per_lembar untuk satuan klik. |
| Diskon item | diskon_nominal = harga_sebelum_diskon × diskon_persen / 100; subtotal = harga_sebelum_diskon − diskon_nominal. |
| Diskon nota | diskon_nominal_nota = total_subtotal_item × diskon_persen_nota / 100. |
| DPP | DPP = total_subtotal_item − diskon_nota. |
| PPN & PPh 23 | PPN = DPP × ppn_persen / 100; PPh 23 = DPP × pph23_persen / 100 (dipotong). |
| Total tagihan | Total = DPP + PPN − PPh 23. |
| DP & sisa | Jika lunas, DP = total. Sisa = maks(total − DP, 0). Nota batal memberi sisa 0. |
| Jatuh tempo | Bila tidak diisi, memakai tempo_hari instansi; jika 0, jatuh_tempo = null. |
| Batas kredit | Piutang aktif pelanggan + nota baru tidak boleh melebihi credit_limit, kecuali override Owner. |
| Ukuran kotor | Ukuran cetak ditambah ekstra finishing (kiri/kanan/atas/bawah) untuk rekomendasi roll. |
| Insentif | Insentif per staf = item selesai × tarif per_item + job selesai × tarif per_job. Tarif default: desainer Rp1.500/item + Rp5.000/job; operator Rp2.000/item + Rp5.000/job; finishing Rp1.500/item + Rp5.000/job. |
| Profitabilitas | Omzet = subtotal item. HPP = harga_modal × luas (meteran) atau × qty (satuan). Laba kotor = omzet − HPP. |
| Pajak reklame | Tanggal expired per instansi; sistem menghitung jatuh tempo tahunan berikutnya dan menyiapkan pengingat H-30 (atau PAJAK_REKLAME_HARI) dengan dedupe per instansi dan tahun. |
| Auto-clean TIFF | Hanya file_cetak_tiff terverifikasi pada nota selesai yang lewat AUTO_CLEAN_TIFF_HARI yang dihapus; preview dan master tidak tersentuh. |


## 8. Struktur Data Utama

| Entitas | Field penting | Relasi / Fungsi |
| --- | --- | --- |
| Instansi | nama_instansi, npwp, is_pkp, ppn_persen, pph23_persen, tempo_hari, credit_limit, pajak_reklame_expired | Induk pelanggan; sumber pajak, tempo, dan limit kredit. |
| Customer | instansi_id, nama_pelanggan, no_wa, kategori, alamat | Dipakai nota dan pengiriman WA. |
| Product | kategori_produk, 4 harga jual, harga_modal, satuan_hitung, klik_per_lembar, mesin_default_id | Sumber harga, HPP, dan satuan hitung. |
| Finishing | nama_finishing, ekstra kiri/kanan/atas/bawah | Menentukan finishing_name dan ukuran kotor. |
| Order | no_nota, customer_id, total_tagihan, jumlah_dp, sisa_tagihan, status_bayar, diskon/PPN/PPh23, jatuh_tempo, approval_token/status/note, status_nota, serah terima | Induk nota; mencatat keuangan dan alur ACC. |
| OrderItem | product_id, finishing_id, lebar_m, tinggi_m, qty, luas_tagihan_m2, harga, diskon, subtotal, status_produksi, file_preview_acc, file_cetak_tiff, acc_admin_id | Detail pesanan dan progres produksi. |
| OrderPayment | tanggal, nominal, metode, keterangan, bukti_bayar, admin_id, shift_id | Riwayat DP/pelunasan dan kasir. |
| DesignRevision | order_id, revisi_ke, catatan_revisi, file_preview, status_revisi, admin_id | Riwayat revisi desain. |
| AdvertisingSpk | jenis_pekerjaan, ukuran_konstruksi, lokasi_pasang, catatan_teknis, status_lapangan | SPK advertising. |
| MaterialRoll / Offcut | jenis, lebar, panjang, stok, status | Stok roll bahan cetak. |
| Supply / SupplyUsage | nama, jenis, stok, stok_minimum, harga_satuan, pemakaian | Tinta dan bahan pembantu. |
| Supplier / PurchaseOrder / GoodsReceipt / SupplierPayment | supplier, PO status, penerimaan, pembayaran | Alur purchasing dan hutang dagang. |
| Shift | kasir_id, waktu buka/tutup, saldo, selisih | Rekonsiliasi kas harian. |
| AuditLog | user, aksi, entitas, deskripsi, IP, waktu | Jejak perubahan penting. |
| WhatsappOutbox | event, to, message, link, dedupe_key, status, retry | Antrean notifikasi WhatsApp. |
| InsentifRate | role (desainer/operator_cetak/finishing), jenis (per_item/per_job), nominal, updated_by | Tarif insentif yang dapat diubah Owner. |
| PrintBatch | item gabungan, lebar, panjang, waste, penghematan | Hasil batch nesting. |


## 9. Ringkasan API dan Integrasi

Berikut ringkasan endpoint yang paling sering dipakai. Endpoint selain grup publik memerlukan token sesi (Bearer atau cookie) dan pembatasan peran.

| Grup | Method & Path | Role | Fungsi |
| --- | --- | --- | --- |
| Autentikasi | GET /api/auth/accounts | Publik | Daftar akun untuk login cepat; kosong bila ENABLE_DEMO_SWITCH=false. |
| Autentikasi | POST /api/auth/login | Publik | Login dengan email dan password; menghasilkan token sesi. |
| Autentikasi | POST /api/auth/switch | Publik (demo) | Ganti akun cepat; hanya aktif bila ENABLE_DEMO_SWITCH=true. |
| Autentikasi | POST /api/auth/logout | Semua role | Menghapus sesi/cookie. |
| Umum | GET /api/events | Semua role | Server-Sent Events untuk pembaruan status real-time. |
| Umum | GET /api/bootstrap | Semua role | Memuat data awal yang dibutuhkan frontend. |
| Umum | POST /api/ai/parse-order | Admin/Kasir | Mengurai teks pesanan menjadi item nota dengan bantuan AI. |
| Instansi | POST /api/instansis | Admin/Owner | Menambah instansi baru. |
| Instansi | PUT /api/instansis/:id | Admin/Owner | Mengubah instansi: pajak, tempo, limit kredit, dan data PIC. |
| Nota | GET /api/orders | Semua role | Daftar nota dengan filter/status. |
| Nota | GET /api/orders/by-nota/:noNota | Semua role | Mencari nota berdasarkan nomor nota. |
| Nota | GET /api/orders/:id | Semua role | Detail lengkap satu nota. |
| Nota | POST /api/orders | Admin/Kasir | Membuat nota, item, token Self-ACC, DP, dan pajak. |
| Nota | POST /api/orders/:id/payments | Admin/Kasir | Mencatat pembayaran/termin dengan bukti. |
| Nota | POST /api/orders/:id/pelunasan | Admin/Kasir | Mencatat pelunasan nota. |
| Nota | POST /api/orders/:id/void | Admin/Owner | Membatalkan nota dengan alasan wajib. |
| Nota | POST /api/orders/:id/reorder | Admin/Kasir | Membuat nota baru dari nota lama. |
| Nota | POST /api/orders/:id/serah-terima | Internal selain Owner | Menyimpan tanda tangan, foto, dan data pengambil. |
| Self-ACC | GET /api/public/approval/:token | Publik | Membuka bukti pesanan; data finansial baru dikirim setelah ACC. |
| Self-ACC | POST /api/public/approval/:token | Publik | Menyetujui atau meminta revisi; ACC ulang ditolak dengan HTTP 409. |
| ACC Admin | GET /api/admin/design-reviews | Admin/Kasir | Daftar desain yang menunggu ACC internal. |
| ACC Admin | POST /api/admin/design-reviews/:orderId/approve | Admin/Kasir | Menyetujui desain internal sebelum TIFF/cetak. |
| ACC Admin | POST /api/admin/design-reviews/:orderId/revise | Admin/Kasir | Meminta revisi desain internal. |
| Desain | GET /api/desainer/queue | Desainer | Antrean pekerjaan desain. |
| Desain | POST /api/desainer/orders/:id/terima | Desainer | Menerima job desain. |
| Desain | POST /api/desainer/orders/:id/preview | Desainer | Mengunggah preview; revisi direset ke menunggu. |
| Desain | POST /api/desainer/items/:itemId/tiff | Desainer | Mengunggah TIFF final (wajib ACC internal). |
| Desain | POST /api/desainer/orders/:id/master | Desainer | Memfinalisasi master bila semua item memiliki TIFF. |
| Cetak | GET /api/operator/queue | Operator Cetak | Antrean cetak per mesin. |
| Cetak | POST /api/operator/items/:id/mulai | Operator Cetak | Memulai cetak item. |
| Cetak | POST /api/operator/items/:id/selesai | Operator Cetak | Menyelesaikan cetak; item ke antrean finishing. |
| Cetak | POST /api/operator/items/:id/gagal-cetak | Operator Cetak | Mencatat kegagalan cetak. |
| Cetak | GET /api/operator/batches | Operator/Owner | Daftar hasil batch nesting. |
| Cetak | POST /api/operator/batch-nesting | Operator Cetak | Menghitung lebar gabungan, waste, dan penghematan. |
| Cetak | POST /api/operator/batches/:id/proses | Operator Cetak | Memproses batch nesting. |
| Finishing | GET /api/finishing/queue | Finishing | Antrean finishing. |
| Finishing | POST /api/finishing/items/:id/konfirmasi | Finishing | Memproses dan menyelesaikan finishing/QC. |
| Advertising | GET /api/advertising/spks | Advertising/Owner/Admin | Daftar SPK lapangan. |
| Advertising | POST /api/advertising/spks/:id/status | Advertising | Mengubah status SPK lapangan. |
| Riwayat | GET /api/riwayat/:divisi | Semua role | Riwayat pekerjaan selesai per divisi. |
| Kasir | GET /api/shifts/current | Admin/Kasir | Shift yang sedang terbuka. |
| Kasir | GET /api/shifts | Admin/Owner | Daftar shift. |
| Kasir | POST /api/shifts/open | Admin/Kasir | Membuka shift kasir. |
| Kasir | POST /api/shifts/:id/close | Admin/Owner | Menutup shift dan rekonsiliasi. |
| Owner | GET /api/owner/dashboard | Owner | Ringkasan workshop. |
| Owner | GET/POST /api/owner/staff | Owner | Daftar dan tambah staf. |
| Owner | PUT/DELETE /api/owner/staff/:id | Owner | Ubah/nonaktifkan/hapus staf dan reset password. |
| Owner | GET /api/owner/audit-logs | Owner | Jejak semua perubahan penting. |
| Owner | GET /api/owner/reports/finance | Owner | Laporan laba rugi, cashflow, dan piutang. |
| Owner | GET /api/owner/reports/export | Owner | Ekspor CSV laporan. |
| Owner | GET /api/owner/reports/materials | Owner | Stok & audit bahan. |
| Owner | GET /api/owner/reports/profit-loss | Owner | Laporan laba rugi. |
| Owner | GET /api/owner/reports/kpi | Owner | KPI produksi per mesin/operator. |
| Owner | GET /api/owner/kpi/insentif | Owner | Perhitungan insentif tim. |
| Owner | PUT /api/owner/kpi/insentif/rates | Owner | Mengubah tarif insentif per divisi. |
| Owner | GET /api/owner/reports/profitabilitas | Owner | Laba kotor per produk dan klien. |
| Owner | GET/POST/PUT /api/owner/suppliers | Owner | Master supplier. |
| Owner | POST /api/owner/suppliers/:id/nonaktif | Owner | Menonaktifkan supplier. |
| Owner | GET/POST/PUT /api/owner/purchase-orders | Owner | Master dan pembuatan PO. |
| Owner | POST /api/owner/purchase-orders/:id/kirim | Owner | Mengirim PO ke supplier. |
| Owner | POST /api/owner/purchase-orders/:id/terima | Owner | Menerima barang; stok dan hutang bertambah. |
| Owner | POST /api/owner/purchase-orders/:id/bayar | Owner | Membayar PO; hutang berkurang. |
| Owner | GET /api/owner/goods-receipts | Owner | Daftar penerimaan barang. |
| Owner | GET /api/owner/supplier-payments | Owner | Daftar pembayaran supplier. |
| Owner | GET /api/owner/whatsapp-outbox | Owner | Antrean pesan WhatsApp. |
| Owner | POST /api/owner/whatsapp-outbox/:id/retry | Owner | Mencoba ulang pengiriman WA. |
| Owner | POST /api/owner/whatsapp/reminder | Owner | Membuat pengingat piutang. |
| Owner | GET/PUT /api/owner/pajak-reklame/:id | Owner | Mengelola tanggal expired pajak reklame instansi. |
| Owner | POST /api/owner/whatsapp/reminder-reklame | Owner | Membuat pengingat pajak reklame H-30. |
| Owner | GET /api/owner/maintenance/tiff-preview | Owner | Preview TIFF yang akan dihapus. |
| Owner | POST /api/owner/maintenance/tiff-clean | Owner | Menjalankan auto-clean TIFF. |
| Owner | POST/DELETE /api/owner/expenses | Owner | Mencatat/menghapus biaya operasional. |
| Owner | PUT /api/owner/settings/products | Owner | Mengubah harga 4 tier dan HPP produk. |
| Owner | POST /api/owner/settings/rolls | Owner | Menambah stok roll bahan. |
| Owner | POST /api/owner/settings/stok-pcs | Owner | Restock produk satuan. |
| Owner | PUT /api/owner/settings/finishings | Owner | Mengubah finishing dan ekstra ukuran. |
| Owner | POST/PUT /api/owner/settings/machines | Owner | Master mesin dan konsumsi tinta. |
| Owner | POST/PUT /api/owner/settings/supplies | Owner | Master tinta/bahan pembantu. |
| Owner | POST /api/owner/settings/supplies/:id/restock | Owner | Restock supply. |


## 10. Keamanan, Audit, dan Catatan Operasional

- Autentikasi memakai token sesi bertanda tangan; dapat dikirim sebagai Bearer token atau cookie. Token juga dipakai oleh frontend untuk memanggil API.
- ENABLE_DEMO_SWITCH=false mematikan login cepat dan ganti akun. Gunakan email + password pada produksi.
- SESSION_SECRET wajib diganti dengan string acak panjang sebelum go-live.
- Semua password seed password123 harus diganti melalui Owner → Staf & Audit Log.
- Pembatasan peran diterapkan di server, bukan hanya menyembunyikan menu di UI.
- Tim Advertising bersifat non-billing: tidak dapat mengakses daftar nota, dan harga/subtotal/pembayaran di-nolkan pada detail nota, serah terima, serta riwayat.
- Owner tidak termasuk dalam endpoint serah terima; aksi ini dilakukan Admin dan divisi produksi/lapangan.
- Unggahan dibatasi ekstensi dan ukuran (MAX_UPLOAD_MB). File disimpan di folder uploads/.
- Mode MySQL memakai transaksi/locking untuk operasi kritis; skema dan migrasi dibuat otomatis dari database/schema.sql.
- Perubahan tarif insentif, pajak reklame, outbox WA, void, pembayaran, dan keputusan ACC tercatat di audit log.
- Ekspor CSV memakai BOM UTF-8, delimiter ;, quoting ganda, dan CRLF agar langsung terbaca di Excel.
- Multi-cabang workshop tidak diimplementasikan; sistem hanya mengelola satu workshop.
- Jangan mengedit server.js manual karena merupakan hasil build dari server.ts. Jalankan npm run build setelah mengubah source.

## 11. Troubleshooting

| Gejala | Penyebab | Penanganan |
| --- | --- | --- |
| Port 3000 sudah dipakai | Aplikasi/proses lain mendengarkan port yang sama | Set PORT=3001 di .env lalu restart. |
| MySQL connection refused | MySQL/XAMPP mati atau salah host/port | Nyalakan MySQL, cek MYSQL_HOST dan MYSQL_PORT. |
| Access denied untuk database | Kredensial salah | Cek MYSQL_USER/MYSQL_PASSWORD atau buat user khusus. |
| Login cepat/ganti akun tidak muncul | ENABLE_DEMO_SWITCH=false | Normal untuk produksi. Login memakai email dan password. |
| Password seed gagal | Data sudah bukan seed atau sudah diganti | Reset lewat Owner → Staf & Audit Log. |
| Pesan WhatsApp tetap pending | WHATSAPP_WEBHOOK_URL belum diisi | Normal; isi webhook atau retry dari Integrasi & Pemeliharaan. |
| Halaman Self-ACC tidak menampilkan harga | Belum ACC atau payload lama | Normal sebelum ACC. Setelah ACC, muat ulang halaman. |
| ACC kedua ditolak | Guard keputusan final | Normal. Hubungi admin bila perlu pembatalan/void. |
| Status revisi tidak bisa ACC | Desainer belum upload preview baru | Minta desainer upload preview; status otomatis kembali menunggu. |
| File TIFF tidak bisa diunggah | ACC internal Admin belum dilakukan | Admin menyetujui di Review Desain (ACC) terlebih dahulu. |
| Auto-clean tidak menghapus file | Belum lewat retensi atau file belum terverifikasi | Cek AUTO_CLEAN_TIFF_HARI dan jalankan Preview dulu. |
| Ingin data contoh lagi | Data operasional sudah terisi | Mode JSON: restore db.json bersih. MySQL: drop database lalu restart untuk seed ulang. |


## 12. Lampiran Checklist


### 12.1 Checklist Harian

| Awal hari | Akhir hari |
| --- | --- |
| Buka shift kasir | Terima pelunasan dan tutup shift |
| Cek antrean desain/cetak/finishing | Cek barang siap diambil dan serah terima |
| Cek stok tinta/roll minimum | Cek KPI produksi dan insentif |
| Buat nota baru dan bagikan link/QR Self-ACC | Cek cashflow, piutang, dan profitabilitas |
| Cek status ACC pelanggan | Cek nota elektronik dan lampiran tagihan lama |
| - | Buat pengingat piutang dan pajak reklame |


### 12.2 Checklist Go-Live

- ENABLE_DEMO_SWITCH=false dan SESSION_SECRET unik.
- Seluruh password seed diganti.
- Master produk, harga 4 tier, HPP, mesin, roll, supply, dan stok minimum terisi.
- Mesin aktif dan mesin default produk sesuai kapasitas lebar/konsumsi tinta.
- Tarif insentif dan tanggal pajak reklame instansi sudah diisi.
- Uji alur: nota → Self-ACC → ACC admin → cetak → finishing → serah terima → pelunasan.
- Uji void/refund, tutup shift, reorder, dan ekspor CSV.
- Uji klik A3+, batch nesting 2–4 item, dan KPI produksi.
- Uji Supplier → PO → Kirim → Terima → Bayar.
- Uji 5 event WhatsApp; tanpa webhook pastikan status pending.
- Uji tanda tangan digital dan preview auto-clean TIFF.
- Backup database dan uploads dijadwalkan.
— Dokumen selesai —

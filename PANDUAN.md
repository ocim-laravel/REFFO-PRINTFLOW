# Panduan Instalasi & Pemakaian Awal — Reffo PrintFlow

Panduan ini untuk memasang aplikasi dan menjalankannya untuk pertama kali, baik memakai penyimpanan **JSON** (cepat, tanpa MySQL) maupun **MySQL/MariaDB** (disarankan untuk produksi).

---

## A. Prasyarat

| Kebutuhan | Keterangan |
| --- | --- |
| Node.js | 20+ (disarankan 22 LTS) |
| npm | Sudah termasuk saat install Node.js |
| Browser | Chrome/Edge terbaru |
| MySQL/MariaDB | Opsional. MariaDB 10.x / MySQL 8.x. Bisa memakai XAMPP |
| Port | `3000` bebas. Jika bentrok, ganti lewat `PORT` di `.env` |

Cek instalasi:

```powershell
node --version
npm --version
```

---

## B. Langkah Instalasi

### 1. Masuk folder project

```powershell
cd "D:\NURROKHIM STL\PROJECT\reffo-printflow"
```

### 2. Install dependency

```powershell
npm install
```

### 3. Buat file `.env`

```powershell
Copy-Item .env.example .env
```

File `.env` dibaca otomatis oleh `dotenv/config` saat server start.

### 4. Pilih mode penyimpanan

#### Opsi 1 — JSON (paling cepat untuk mencoba)

Isi/ Pastikan di `.env`:

```env
DB_DRIVER=json
PORT=3000
ENABLE_DEMO_SWITCH=false
SESSION_SECRET=ganti-dengan-string-acak-panjang
```

Data tersimpan di `data/db.json`. Tidak perlu menjalankan MySQL.

#### Opsi 2 — MySQL / MariaDB (produksi)

Pastikan MySQL XAMPP sudah berjalan di port `3306`, lalu isi `.env`:

```env
NODE_ENV=production
DB_DRIVER=mysql
MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_USER=reffo_app
MYSQL_PASSWORD=password-kuat
MYSQL_DATABASE=reffo_printflow
PORT=3000
SESSION_SECRET=ganti-dengan-string-acak-panjang-minimal-32-karakter
ENABLE_DEMO_SWITCH=false
APP_URL=http://localhost:3000
MAX_UPLOAD_MB=20
KOMISI_PERSEN=1
PAJAK_REKLAME_HARI=30
```

Untuk uji lokal memakai user bawaan XAMPP:

```env
DB_DRIVER=mysql
MYSQL_USER=root
MYSQL_PASSWORD=
MYSQL_DATABASE=reffo_printflow
```

> Untuk go-live, jangan pakai `root` tanpa password. Buat user khusus:
>
> ```sql
> CREATE DATABASE IF NOT EXISTS reffo_printflow
>   CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
> CREATE USER IF NOT EXISTS 'reffo_app'@'localhost' IDENTIFIED BY 'password-kuat';
> GRANT ALL PRIVILEGES ON reffo_printflow.* TO 'reffo_app'@'localhost';
> FLUSH PRIVILEGES;
> ```

Skema tabel dibuat dan dimigrasikan otomatis dari `database/schema.sql` saat server start. Data awal (seed) hanya diisi jika tabel `users` masih kosong, jadi database lama tidak ditimpa.

### 5. Cek dan build

```powershell
npm run lint
npm run build
```

### 6. Jalankan server

Development:

```powershell
npm run dev
```

Produksi di Windows:

```powershell
$env:NODE_ENV='production'; node server.js
```

Buka browser: **http://localhost:3000**

Jika koneksi MySQL berhasil, log server menampilkan:

```text
Reffo PrintFlow terhubung ke MySQL localhost.
Reffo PrintFlow server berjalan pada http://0.0.0.0:3000
```

### 7. Jalankan WhatsApp Bridge Lokal (opsional, disarankan)

Aplikasi bisa mengirim WhatsApp otomatis walaupun dijalankan di `localhost`. Bridge jalan di PC yang sama, jadi **tidak perlu IP publik, port forwarding, atau membuka WhatsApp Web manual**.

1. Pastikan `.env` berisi:

   ```env
   WHATSAPP_WEBHOOK_URL="http://127.0.0.1:3101/send"
   WA_BRIDGE_PORT="3101"
   WA_BRIDGE_AUTH_DIR="wa-bridge/auth"
   ```

2. Jalankan **dua terminal**:

   ```powershell
   # terminal 1 — aplikasi
   npm run dev

   # terminal 2 — bridge WhatsApp
   npm run wa:bridge
   ```

3. Buka **http://127.0.0.1:3101/qr**, lalu pindai memakai WhatsApp di HP (⋮ → **Perangkat Tertaut** → **Tautkan perangkat**). QR hanya perlu dipindai **sekali**; sesi tersimpan di `wa-bridge/auth/`.

4. Cek **http://127.0.0.1:3101/health**. Nilai `whatsapp` harus `connected`.

5. Uji dengan membuat nota atau pengingat. Status di **Owner → Integrasi & Pemeliharaan** harus berubah dari `pending` menjadi `terkirim`.

6. Konfigurasi gateway juga bisa diubah tanpa restart server melalui menu **Owner → Setting WhatsApp Gateway**. Di halaman tersebut, Owner dapat mengubah Webhook URL, token, APP URL, mengaktifkan/nonaktifkan gateway, serta mengirim pesan uji ke nomor tertentu.

Catatan:

- `WA_BRIDGE_TOKEN` boleh kosong. Bila diisi, isi juga `WHATSAPP_WEBHOOK_TOKEN` dengan nilai sama.
- Bridge otomatis menambahkan tautan Self-ACC/nota ke pesan dan mencegah pengiriman ganda.
- Lima event yang dikirim: `nota_dibuat`, `preview_siap_acc`, `siap_diambil`, `piutang_jatuh_tempo`, `pajak_reklame_jatuh_tempo`.
- Bila bridge belum tersambung, pesan tetap `pending` dan aplikasi mencoba ulang maksimal 3 kali.
- Folder `wa-bridge/auth/` sudah masuk `.gitignore`; jangan pernah di-commit.

---

## C. Akun Awal (Seed)

Semua akun awal memakai password acak yang ditulis ke **`data/initial-credentials.txt`**. File ini tidak ikut git; segera ganti password lalu hapus file tersebut.

| Nama | Email | Peran |
| --- | --- | --- |
| Pak Hendra | `owner@reffoprint.id` | Owner / Direktur |
| Rina | `admin@reffoprint.id` | Admin / Kasir |
| Budi | `desainer@reffoprint.id` | Desainer Grafis |
| Agus | `operator@reffoprint.id` | Operator Cetak |
| Dedi | `finishing@reffoprint.id` | Divisi Finishing |
| Eko | `advertising@reffoprint.id` | Tim Advertising |

Jika `ENABLE_DEMO_SWITCH=false`, pilihan login cepat/ganti akun tidak muncul. Login wajib memakai email dan password.

### Wajib dilakukan pertama kali

1. Login sebagai **Owner**.
2. Buka menu **Staf & Audit Log**.
3. Gunakan tombol **Reset kata sandi** untuk mengganti password semua akun di atas.
4. Kembali ke `.env`, ganti `SESSION_SECRET` dengan string acak panjang, lalu restart server.
5. Pastikan `ENABLE_DEMO_SWITCH=false` sebelum dipakai operasional.

---

## D. Langkah Pemakaian Saat Awal Jalan

### 1. Owner — siapkan master data

Buka menu **Pengaturan Master**:

- Roll bahan: **Tambah Stok Roll Bahan Baru** / **Tambah Roll Aktif**.
- Produk satuan: **Restock Produk Satuan (Pcs)**.
- Mesin: **Master Mesin Cetak & Antrean** — tambah mesin, konsumsi tinta per m², dan urutan antrean.
- Supply: **Master Stok Tinta & Bahan Pembantu** — tinta, bahan finishing, stok minimum, harga satuan.
- Harga: **Master Harga Jual (4 Tier) & Harga Modal (HPP)** — umum, reseller, prioritas, pegawai, plus `harga_modal`.

Lanjutkan ke:

- **Supplier & Purchase Order** — tambah supplier bila belum ada.
- **KPI & Insentif Tim** — cek/ubah tarif insentif desainer, operator, finishing. Tarif default:
  - desainer: Rp1.500/item + Rp5.000/nota
  - operator cetak: Rp2.000/item + Rp5.000/nota
  - finishing: Rp1.500/item + Rp5.000/nota
- **Integrasi & Pemeliharaan** — isi tanggal pajak reklame per instansi dan jendela pengingat (default H-30). Gateway WA bisa memakai bridge lokal (lihat bagian B.7); tanpa `WHATSAPP_WEBHOOK_URL`, pesan tetap antre dengan status `pending`.

### 2. Admin / Kasir — buat nota pertama

1. Buka **Shift & Tutup Kasir**, lalu buka shift.
2. Buka **Daftar Nota & Order** → **Buat Nota Baru**.
3. Pilih pelanggan/instansi. Jika instansi baru, isi juga tanggal pajak reklame bila tersedia.
4. Isi item: produk, ukuran, qty, diskon item. Harga otomatis mengikuti kategori pelanggan.
5. Isi diskon nota, PPN, PPh 23, DP, dan metode pembayaran.
6. Simpan nota. Nota masuk antrean desain. Link `/acc/<token>` otomatis dibuat (kecuali Self-ACC
   dinonaktifkan) dan dapat dibagikan lewat QR pada nota atau pesan WhatsApp.

### 3. Pelanggan — Self-ACC, bukti pesanan, dan nota elektronik

1. Buka link `/acc/<token>` dari QR/WhatsApp. Tidak perlu login.
2. **Sebelum ACC:** periksa daftar item, ukuran, finishing, qty, catatan desain, lampiran briefing,
   dan preview desain. Nama/harga/subtotal dan total tagihan sengaja tidak ditampilkan serta tidak
   dikirim oleh server pada tahap ini.
3. Isi nama PIC (opsional) lalu pilih **Setujui & Tampilkan Nota**, atau **Minta Revisi** dengan
   catatan wajib.
4. **Setelah ACC:** halaman berubah menjadi nota elektronik. Harga satuan, subtotal, diskon, DPP,
   PPN, PPh 23, total tagihan, DP, sisa tagihan, jatuh tempo, dan riwayat pembayaran muncul otomatis.
   Tombol **Cetak / Simpan PDF** tersedia.
5. Di bawah nota, sistem melampirkan nota lain milik pelanggan/instansi yang sama yang masih punya
   sisa tagihan (maksimal 10 nota), berikut ringkasan total yang harus dibayar saat ini.
6. Keputusan ACC bersifat final: mencoba menyetujui ulang akan ditolak. Bila memilih revisi, setelah
   desainer mengunggah preview baru halaman kembali ke status **Menunggu Persetujuan** dan dapat
   di-ACC ulang. ACC pelanggan tidak menggantikan ACC internal Admin.

### 4. Desainer — siapkan file cetak

1. Buka **Antrean Desain**, ambil job.
2. Unggah preview untuk ACC. Jika pelanggan meminta revisi, unggah preview terbaru: status Self-ACC
   otomatis kembali ke **Menunggu Persetujuan** dan catatan revisi lama dihapus.
3. Admin membuka **Review Desain (ACC)** dan menyetujui.
4. Desainer mengunggah file TIFF final.

### 5. Operator Cetak — produksi

1. Buka **Antrean Cetak**, pilih mesin, mulai cetak.
2. Catat klik untuk produk A3+ dan gunakan **Batch Nesting** bila perlu.
3. Klik **Selesai Cetak**. Status item naik ke antrean finishing.

### 6. Finishing — QC dan serah terima

1. Buka **Antrean Finishing**, proses item.
2. Catat bahan pembantu yang dipakai.
3. Klik **Siap Diambil** setelah QC.
4. Buka **Serah Terima Barang** untuk serahkan barang ke pelanggan.

### 7. Admin — tutup hari

1. Terima pelunasan piutang bila ada.
2. Buka **Shift & Tutup Kasir**, tutup shift, cek selisih tunai/transfer/QRIS.

### 8. Owner — cek hasil

- **Ringkasan Workshop** dan **Rekap Semua Nota**
- **Cashflow & Piutang** → buat pengingat piutang
- **Integrasi & Pemeliharaan** → buat pengingat pajak reklame, cek outbox WA, retry bila perlu
- **KPI Produksi** → performa operator & mesin
- **KPI & Insentif Tim** → insentif otomatis per staf
- **Analisis Profitabilitas** → laba kotor per produk dan per klien
- **Laporan Laba Rugi**, **Stok & Audit Bahan**, **Supplier & Purchase Order**
- **Staf & Audit Log** → jejak semua perubahan penting
- Ekspor CSV tersedia di laporan Owner dengan delimiter `;`, BOM UTF-8, dan CRLF.

---

## E. Checklist Harian Singkat

| Awal hari | Akhir hari |
| --- | --- |
| Buka shift kasir | Terima pelunasan & tutup shift |
| Cek antrean desain/cetak/finishing | Cek barang siap diambil & serah terima |
| Cek stok tinta/roll minimum | Cek KPI produksi & insentif |
| Buat nota baru & bagikan link/QR Self-ACC | Cek cashflow, piutang, profitabilitas |
| Cek status ACC pelanggan | Cek nota elektronik & lampiran tagihan lama |
| — | Buat pengingat piutang & pajak reklame |

---

## F. Backup & Restore

### Mode JSON

Backup:

```powershell
Copy-Item data\db.json "C:\backup\reffo-db-$(Get-Date -Format yyyyMMdd).json"
```

Restore:

```powershell
Copy-Item "C:\backup\reffo-db-YYYYMMDD.json" data\db.json -Force
```

Sebelum restore, matikan server agar file tidak ditulis ulang.

### Mode MySQL

Backup:

```powershell
& "C:\xampp\mysql\bin\mysqldump.exe" -u reffo_app -p reffo_printflow > "C:\backup\reffo-$(Get-Date -Format yyyyMMdd).sql"
```

Restore:

```powershell
& "C:\xampp\mysql\bin\mysql.exe" -u reffo_app -p reffo_printflow < "C:\backup\reffo-YYYYMMDD.sql"
```

---

## G. Masalah Umum

| Gejala | Penyelesaian |
| --- | --- |
| Port `3000` sudah dipakai | Set `PORT=3001` di `.env`, lalu restart |
| MySQL connection refused | Nyalakan MySQL/XAMPP, cek host & port |
| Access denied | Cek `MYSQL_USER` / `MYSQL_PASSWORD` |
| Login cepat tidak muncul | Normal jika `ENABLE_DEMO_SWITCH=false` |
| Pesan WA tetap `pending` | Cek `WHATSAPP_WEBHOOK_URL`; bila memakai bridge, pastikan `npm run wa:bridge` jalan dan `/health` menunjukkan `connected` |
| `/qr` tidak menampilkan QR | Bridge belum sempat terhubung atau sesi sudah tersambung; tunggu beberapa detik atau cek `/health` |
| `/send` menjawab 503 | WhatsApp bridge belum `connected`; pindai QR atau tunggu reconnect |
| Password seed tidak berhasil | Seed hanya untuk data baru; reset lewat **Staf & Audit Log** |
| Ingin data contoh lagi | Mode JSON: kembalikan `data/db.json` dari backup bersih. Mode MySQL: dropp database lalu restart agar seed ulang |

---

## H. Catatan Penting

- Data lama aman: field baru bersifat opsional dan dimigrasikan otomatis.
- Multi-cabang **tidak diimplementasikan** sesuai permintaan.
- Semua perubahan tarif insentif, tanggal pajak reklame, dan pengingat WA tercatat di audit log.
- Jangan mengedit `server.js` manual; file itu hasil `npm run build`.

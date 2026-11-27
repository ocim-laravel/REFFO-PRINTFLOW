# Rencana Revisi & Rebuild Sistem Reffo PrintFlow

Dokumen ini disusun berdasarkan verifikasi langsung terhadap kode sumber saat ini (`server.ts`, `server/store.ts`, `server/mysql-adapter.ts`, `database/schema.sql`, `wa-bridge/server.mjs`, `src/**`), dokumentasi operasional (`DOKUMENTASI_SISTEM.md`), jadwal induk (`JADWAL_REVISI_SYSTEM.md`), serta seluruh catatan revisi **Bagian 1 (Alur Kerja)**, **Bagian 2 (SOP per Divisi)**, dan **Bagian 3 (To-Do List Go-Live)**.

---

## 1. Ringkasan Pemahaman Sistem & SOP Saat Ini (Terverifikasi di Kode)

### 1.1 Peran & Akses
1. **Owner**: Mengelola master data (`products`, `finishings`, `machines`, `rolls`, `supplies`), supplier & PO, tarif insentif, pajak reklame, WhatsApp Gateway, staf & audit log, serta laporan keuangan/KPI/profitabilitas/ekspor CSV.
2. **Admin / Kasir**: Membuka/menutup shift kasir, membuat nota (4 tier harga, diskon item/nota, PPN/PPh 23, credit limit + override, token Self-ACC, SPK opsional), menerima pembayaran DP/termin/pelunasan, melakukan ACC desain internal, void/reorder nota, dan serah terima barang.
3. **Desainer**: Mengambil antrean (`terima`), mengunggah preview desain (`menunggu_acc` + outbox WA `preview_siap_acc`), menangani revisi, mengunggah TIFF per item (terkunci sampai ada `acc_admin_id`), dan finalisasi master agar masuk `antrean_cetak`.
4. **Operator Cetak**: Mengambil antrean cetak, memilih mesin & memulai cetak, mencatat klik A3+, menyelesaikan cetak (potong roll/offcut otomatis, buat offcut otomatis jika sisa lebar `>= 0.5m`, estimasi tinta tunggal dari mesin), batch nesting (hitung tanpa potong roll), dan lapor gagal cetak.
5. **Finishing**: Memproses item `antrean_finishing`, input pemakaian bahan pembantu (memotong stok `supplies`), lalu konfirmasi `siap_diambil` (memicu WA `siap_diambil`).
6. **Advertising (Non-Billing)**: Mengelola SPK lapangan (`antrean` → `perakitan` → `pemasangan` → `selesai`). Seluruh nominal harga/tagihan/pembayaran dinolkan oleh backend.
7. **Pelanggan (Self-ACC `/acc/<token>`)**: Akses tanpa login; harga disembunyikan sebelum ACC; setelah setuju (final, guard HTTP 409) tampil nota elektronik + maksimal 10 tagihan lama instansi.

### 1.2 Audit Baseline Kondisi Kode Terkini (Working Copy)
Sebelum menyusun fase eksekusi, berikut hasil verifikasi status pekerjaan yang **sudah ada di working copy** (belum di-commit ke Git) vs **masih tertunda**:

- **Sudah Selesai di Working Copy (Fase 0 & Fase 1 + sebagian Fase 2)**:
  - **MySQL CRUD Diff & Transactional Lock**: `server/mysql-adapter.ts` memakai `persistDiff()` (bukan snapshot `DELETE+INSERT` massal) dan `runLocked()` (`SELECT ... FOR UPDATE`); `store.critical()` + `runTransactional()` membungkus `/operator/items/:id/selesai`, `/gagal-cetak`, `/finishing/items/:id/konfirmasi`, dan `/owner/purchase-orders/:id/terima`.
  - **Proteksi `/uploads` & Self-ACC File**: `GET /uploads/*` wajib `requireAuth()`; file publik Self-ACC dilayani lewat `GET /api/public/approval/:token/file/:filename` dengan validasi kepemilikan nota dan anti path traversal (`server/uploads.ts`).
  - **Keamanan Env & Kredensial**: `server/security.ts` memvalidasi `SESSION_SECRET` (≥ 32 char), `WA_BRIDGE_TOKEN`, `WHATSAPP_WEBHOOK_TOKEN`, dan `ENABLE_DEMO_SWITCH=false` saat `NODE_ENV=production`. Password seed acak disimpan ke `data/initial-credentials.txt` / `data/credentials-reset-*.txt`; `LoginView.tsx` bersih dari hardcode password.
  - **Backup JSON Sebelum Reset**: `server/store.ts` menyalin `db.json` corrupt ke `db.json.corrupt-<timestamp>` sebelum membuat seed.
  - **Sebagian Item Fase 2 yang Sudah Terpasang di `server.ts`**:
    - `getActiveUser()` (`server.ts:152`) sudah memeriksa `user.active === false`.
    - `GET /api/riwayat/:divisi` (`server.ts:3295`) sudah menyensor nominal berdasarkan `actor.role === 'advertising'`.
    - `POST /api/orders/:id/void` (`server.ts:1953-1960`) sudah mengubah item aktif menjadi `'dibatalkan'` dan mencatat ke audit log.
    - `POST /api/finishing/items/:id/konfirmasi` (`server.ts:3078-3095`) sudah memvalidasi seluruh baris bahan pembantu sebelum memotong stok.
  - **Verifikasi Awal**: `npm test` (12/12 di `tests/fase1.test.ts`) lulus dan `npm run lint` (`tsc --noEmit`) 0 error.
  - **Progres Terkini (27 Nov 2026)**: Fase 0–3 selesai; `npm run lint` 0 error, `npm test` 26/26 lulus, `npm run build` sukses. Fase 2 Addendum: token SSE tidak lagi di query URL (cookie + `withCredentials`). Fase 3 Addendum: 5 tabel baru, `.prn`/grup cetak/WOS, tinta per warna, QC finishing, purchasing/PO, tab Batal/Piutang, ErrorBoundary, 401 auto-logout, badge polling. Catatan: laporan tinta harian Owner dan override konversi tinta via UI Owner masih menyusul.

---

## 2. Peta Revisi Terpadu (Jadwal Induk + Catatan Bagian 1–3)

Mengikuti prinsip pada `JADWAL_REVISI_SYSTEM.md` (*satu fase selesai → uji → lanjut; backup DB + uploads sebelum tiap fase; fitur baru tidak dicampur ke fase kritis*), berikut rencana revisi terstruktur:

### Fase 0 & Fase 1 — Finalisasi & Commit Fondasi (Prasyarat Sebelum Fase 2)
- [ ] Review & commit perubahan Fase 0 + Fase 1 yang saat ini masih *untracked/modified* di Git (setelah verifikasi `.gitignore` mengecualikan `wa-bridge/auth/`, `data/backups/`, `data/credentials-reset-*.txt`, `data/db.json`).
- [ ] Buat backup baru `data/db.json` dan `uploads/` sebelum masuk ke Fase 2.
- [ ] Siapkan skrip/env uji terpisah (`.env.test` / data dummy terisolasi) untuk menguji revisi tanpa merusak data operasional.

---

### Fase 2 — Stabilisasi Logika, Keamanan Sisa, & Revisi Inti Admin/Pajak/WA (✅ Selesai)

#### 2A. Penutupan Celah Akses & Bug Transaksi (dari Bagian 3 Tahap 2)
1. **Hapus `preset_url` & Mockup Hardcoded Desainer**
   - *Target*: `server.ts` (`POST /api/desainer/orders/:id/preview` baris ~2470-2472) dan `src/components/desainer/DesainerView.tsx` (baris 32, 60, 388-415, 438).
   - *Perubahan*: Wajibkan upload file gambar nyata (`req.file`); hapus opsi mockup cepat hardcoded.
2. **Pindahkan Token Ekspor Laporan Owner dari Query URL ke Header**
   - *Target*: `src/lib/api.ts` + 5 view Owner (`OwnerFinanceView.tsx`, `OwnerInsentifView.tsx`, `OwnerIntegrationsView.tsx`, `OwnerProfitabilitasView.tsx`, `OwnerPurchasingView.tsx`).
   - *Perubahan*: Buat helper `downloadAuthorized(url, filename)` memakai `fetch` + header `Authorization: Bearer ...` → `Blob` → unduh; hapus seluruh `window.open(...token=...)`.
3. **Validasi Input Nota, Tanggal, ID, dan Gagal Cetak**
   - *Target*: `server.ts`.
   - *Perubahan*:
     - Pindahkan validasi kelengkapan SPK Advertising (`POST /api/orders` baris ~1661-1677) ke **sebelum** `db.instansis.push`, `db.customers.push`, `db.orders.push`, `db.order_items.push`, dan `db.order_payments.push` agar tidak meninggalkan nota/DP yatim.
     - Tambahkan helper `parseTanggalISO(val)` (validasi `YYYY-MM-DD`, tolak HTTP 422 jika invalid) untuk `jatuh_tempo` & `deadline`.
     - Tambahkan helper `parsePositiveId(raw)` berbasis `Number.isInteger` (tolak HTTP 422 jika non-integer) menggantikan `Number(req.params.id)` di seluruh route.
     - Perkuat guard `gagal-cetak`: tambahkan status `gagal_cetak` (atau catat penanda gagal pada sesi cetak aktif) sehingga item yang gagal cetak wajib melalui proses cetak ulang / mulai baru dan tidak bisa diklik "Selesai Cetak" dua kali pada sesi yang sama.
4. **Form Edit Instansi (Limit Kredit, Tempo, & Pajak)**
   - *Target*: `src/components/owner/OwnerSettingsView.tsx` + `src/App.tsx`.
   - *Perubahan*: Tambahkan tab/panel **"Instansi & Kredit"** untuk mengedit `npwp`, `is_pkp`, `ppn_persen`, `pph23_persen`, `tempo_hari`, dan `credit_limit` terhubung ke `PUT /api/instansis/:id` yang sudah ada.

#### 2B. Revisi Operasional Admin, Pajak, WA & Sinkronisasi Status (dari Bagian 1 & 2)
5. **Admin Login Langsung Shift Aktif (Admin Tunggal)** *(Revisi 1.1 #1)*
   - *Target*: `server.ts` (`POST /api/auth/login`, `POST /api/auth/switch`, `GET /api/shifts/current`), `src/components/AppShell.tsx`, `src/components/admin/AdminShiftView.tsx`.
   - *Perubahan*: Saat user ber-role `admin` berhasil login, jika belum ada shift berstatus `'buka'` miliknya, sistem otomatis membuat shift baru (`opening_cash = 0`, catatan `'Dibuka otomatis saat login'`, catat audit log `'shift_auto_open'`). Tampilkan indikator badge **"Shift Aktif"** di UI Admin.
6. **Pengaturan Pajak Sesuai Aturan Indonesia + Setting Fleksibel** *(Revisi 1.1 #2)*
   - *Target*: `database/schema.sql`, `server/store.ts`, `server/mysql-adapter.ts`, `server.ts`, `src/types.ts`, `src/components/owner/OwnerSettingsView.tsx`, `src/components/admin/OrderCreateModal.tsx`.
   - *Perubahan*:
     - Tambah tabel/entitas `tax_settings`: `ppn_persen_default` (default `11`), `pph23_persen_default` (default `2`), `mode_harga` (`'belum_termasuk_ppn' | 'sudah_termasuk_ppn'`), `ppn_termasuk_diskon` (boolean), `potong_pph23_otomatis` (boolean), `updated_at`, `updated_by`.
     - Endpoint `GET /api/settings/tax` (bootstrap) & `PUT /api/owner/settings/tax`.
     - Prioritas perhitungan nota: **Payload per-nota → Pengaturan Instansi → Pengaturan Pajak Global**.
     - Jika `mode_harga === 'sudah_termasuk_ppn'`, DPP dihitung mundur `harga / (1 + ppn/100)` agar PPN tidak dobel.
     - Tambah panel **"Pajak & Faktur"** di `OwnerSettingsView` lengkap dengan simulasi/preview perhitungan dan catatan regulasi Indonesia.
7. **Alur WhatsApp, Lampiran Preview/Self-ACC, & Halaman Setting WA Admin (Sementara)** *(Revisi 1.1 #3)*
   - *Target*: `server.ts`, `wa-bridge/server.mjs`, `src/components/AppShell.tsx`, `src/App.tsx`, komponen baru `src/components/admin/AdminWhatsAppGatewayView.tsx`.
   - *Perubahan*:
     - Pastikan event `nota_dibuat` hanya dipicu oleh Admin (create/reorder) dan wajib melampirkan tautan Self-ACC `/acc/<token>` bila Self-ACC aktif.
     - Saat Desainer mengunggah preview awal maupun preview revisi (`POST /api/desainer/orders/:id/preview`), pastikan WA `preview_siap_acc` terkirim dengan tautan `/acc/<token>` **serta mendukung lampiran file gambar preview** (tambahkan field `media_url` / `media_path` pada `whatsapp_outbox` dan dukungan kirim gambar di `wa-bridge/server.mjs`).
     - Buat endpoint `GET/PUT/POST /api/admin/settings/whatsapp` (`requireAuth(['admin', 'owner'])`) dan menu sidebar **"Setting WA (Sementara)"** khusus Admin yang menggunakan ulang UI gateway WA agar Admin bisa mengatur & menguji WA tanpa login Owner.
8. **Sinkronisasi Otomatis Status ACC / Revisi di Kedua Divisi (Admin & Desainer)** *(Revisi 1.1 #8)*
   - *Target*: `server.ts` (`POST /api/public/approval/:token`, `POST /api/admin/design-reviews/:orderId/approve|revise`, `POST /api/desainer/orders/:id/preview`), `src/types.ts`, `src/App.tsx`.
   - *Perubahan*:
     - Pisahkan jejak persetujuan pelanggan (`acc_pelanggan_at`, `acc_pelanggan_nama`) dari ACC internal Admin (`acc_admin_id`, `waktu_acc`) agar status di Admin dan Desainer terbaca sinkron.
     - Ketika pelanggan atau Admin melakukan ACC atau meminta revisi, selain update status item & broadcast SSE (`design_reviewed`), perbaiki mekanisme sinkronisasi di `App.tsx` agar **seluruh badge antrean & daftar antrean** divisi Admin dan Desainer langsung ter-update otomatis tanpa harus pindah menu atau refresh manual.

---

### Fase 3 — Revisi Produksi Inti: Desain, Operator Cetak (.prn, Grup, Bahan, Tinta), Finishing QC, & UI Admin (✅ Selesai)

#### 3A. Revisi Divisi Desainer *(Revisi 1.1 #9 & #10)*
1. **Upload File TIFF: Per Item & Massal**
   - *Target*: `server.ts`, `src/components/desainer/DesainerView.tsx`.
   - *Perubahan*:
     - Pertahankan upload per item `POST /api/desainer/items/:itemId/tiff`.
     - Tambahkan `POST /api/desainer/orders/:id/tiff-massal` (multer `array('files', 30)`) yang menerima `peta` JSON `[{ filename, item_id }]`.
     - **Logika Pemetaan Massal (Menghilangkan Ambiguitas)**:
       1. Desainer memilih banyak file `.tif/.tiff` sekaligus dalam satu modal pada nota tertentu.
       2. UI otomatis mencoba mencocokkan sementara berdasarkan pola nama file (`item-<id>`, nomor urut item `1_...`, atau kemiripan `nama_item`), lalu **menampilkan tabel pencocokan `File ↔ Item`** agar Desainer dapat memilih/mengoreksi pasangan setiap file sebelum klik Unggah.
       3. Backend memvalidasi seluruh file terhadap `peta`: setiap file harus terpetakan ke `item_id` valid milik nota tersebut dan satu item tidak boleh ganda tanpa konfirmasi; file tanpa pasangan ditolak **HTTP 422** secara atomik (tidak ada file menempel diam-diam).
2. **Master Wajib Format Editable**
   - *Target*: `server.ts` (`POST /api/desainer/orders/:id/master`), `DesainerView.tsx`.
   - *Perubahan*: Wajibkan file unggahan fisik (`req.file` tidak boleh kosong / hapus fallback string `filename` saja) dengan validasi ekstensi **strict editable**: `.ai`, `.psd`, `.cdr` (atau format master editable Corel/Illustrator/Photoshop yang disepakati). Tolak `.jpg`, `.png`, `.pdf`, `.tif` pada endpoint finalisasi master dengan HTTP 422.

#### 3B. Revisi Divisi Operator Cetak *(Revisi 1.1 #11, #12, #13)*
3. **Mode Mesin Tunggal (Tanpa Pilihan Mesin)**
   - *Target*: `server.ts` (`/api/operator/items/:id/mulai`, `/selesai`, `/batch-nesting`), `src/components/operator/OperatorView.tsx`.
   - *Perubahan*: Hilangkan dropdown/filter pilihan mesin dari UI Operator. Backend otomatis memilih mesin aktif tunggal (`db.machines.find(m => m.aktif)` dengan fallback `product.mesin_default_id`).
4. **Checklist Penataan Maintop & Grup Cetak (Qty Parsial & Konfirmasi Grup/Per Item)**
   - *Target*: `database/schema.sql`, `server/store.ts`, `server/mysql-adapter.ts`, `src/types.ts`, `src/lib/format.ts`, `server.ts`, `src/components/operator/OperatorView.tsx`.
   - *Perubahan*:
     - Perluas enum `ProductionStatus`: tambah `siap_tata` (sudah ditata di Maintop, belum dikirim ke grup/dicetak), `gagal_cetak`, dan `cetak_ulang`.
     - Tambah entitas `cetak_grup` (`id`, `kode_grup`, `operator_id`, `machine_id`, `status`, `tanggal`, `catatan`, `created_at`, `updated_at`) dan `cetak_grup_item` (`id`, `grup_id`, `order_item_id`, `qty_cetak`, `panjang_file_m`, `lebar_file_m`, `sumber_bahan`, `roll_id`, `cattoff_id`, `offcut_id`, `sisa_panjang_m`, `sisa_lebar_m`, `masuk_wos`, `status`, `catatan`).
     - Alur UI Operator menjadi 3 langkah jelas:
       1. **Antrean & Checklist Penataan Maintop**: Operator mencentang item yang sudah ditata di Maintop → status berubah ke `siap_tata` (terlihat lintas divisi/operator lain sebagai pemberitahuan sudah diproses).
       2. **Buat Grup Cetak (Menunggu Cetak)**: Operator memilih beberapa item (mis. A, B, N, V), menentukan `qty_cetak` per item (mendukung orderan multi-qty / cetak bertahap), dan memilih sumber bahan awal (`roll` utuh / `cattoff` / `offcut`) → dikirim sebagai satu Grup Cetak ke tab/halaman **Menunggu Cetak**.
       3. **Konfirmasi Selesai Cetak (Per Grup atau Per Item)**: Operator dapat konfirmasi **1× untuk seluruh grup** atau **per item** (jika ada kendala mesin/bahan habis/qty berbeda).
5. **Input Ukuran `.prn` Harian, Stok `cattoff`, Offcut Manual vs WOS**
   - *Target*: `database/schema.sql`, `server/store.ts`, `server/mysql-adapter.ts`, `server.ts`, `OperatorView.tsx`, `OwnerSettingsView.tsx`, `OwnerMaterialsView.tsx`.
   - *Perubahan*:
     - Tambah tabel `stok_cattoff` (`id`, `kode`, `jenis_bahan`, `lebar_m`, `panjang_awal_m`, `panjang_sisa_m`, `status`, `created_at`, `updated_at`) beserta menu master/restock di Owner.
     - Saat konfirmasi selesai cetak, operator menginput **panjang & lebar aktual dari file `.prn`** (RIP Maintop) serta sumber bahan (`roll`, `cattoff`, atau `offcut`).
     - **Validasi Harian**: Input selesai cetak dan ukuran `.prn` wajib dicatat pada tanggal hari yang sama dengan proses cetak (`YYYY-MM-DD` sesuai hari kerja cetak) agar laporan harian akurat.
     - **Sisa Bahan (Offcut vs WOS)**: Hapus pembuatan offcut otomatis; operator diberi opsi input ukuran sisa bahan yang masih layak pakai → tersimpan ke `material_offcuts`. Jika operator **tidak** menginput offcut, seluruh selisih bahan otomatis tercatat ke **WOS** (`material_logs.wos_potong_m2`).
     - Semua pemotongan stok (`material_rolls`, `stok_cattoff`, `material_offcuts`, `tinta_warna`, `products`) dibungkus `store.critical(...)` + `runTransactional(...)`.
6. **Perhitungan Tinta Per Warna (Basis Galon 5 Liter)**
   - *Target*: `database/schema.sql`, `server/store.ts`, `server.ts`, `OwnerSettingsView.tsx`, `OwnerMaterialsView.tsx`.
   - *Perubahan*:
     - Tambah entitas `tinta_warna` (`C`, `M`, `Y`, `K`, dll. dalam satuan `ml`, `stok`, `kapasitas_galon_ml = 5000`, `roll_per_galon = 6`, `luas_per_roll_m2 = 224` dari `3.2m × 70m`) dan `pemakaian_tinta`.
     - Rumus default: `5000 ml / (6 × 224 m²) = 3,72 ml/m²` (nilai kalibrasi dapat diubah Owner di Pengaturan jika ukuran roll/asumsi berubah).
     - Laporan bahan Owner (`OwnerMaterialsView.tsx`) menampilkan filter default **"Hari Ini"**, pemakaian tinta per warna, sisa offcut input manual, dan WOS.

#### 3C. Revisi Divisi Finishing *(Revisi 1.1 #14)*
7. **Finishing sebagai QC Cetak, Ajukan Cetak Ulang, Bukti Foto, & Hapus Potong Bahan Pembantu**
   - *Target*: `database/schema.sql`, `server/store.ts`, `server.ts`, `src/components/finishing/FinishingView.tsx`.
   - *Perubahan*:
     - Tambahkan endpoint `POST /api/finishing/items/:id/qc` (`hasil: 'lolos' | 'cacat'`, `catatan`, upload `foto`). Jika `cacat`, item kembali ke antrean operator dengan status `cetak_ulang` + menyimpan `foto_cetak_ulang` + audit log.
     - Pada `POST /api/finishing/items/:id/konfirmasi`:
       - **Hapus** kewajiban/logika pemotongan stok `supplies` (`bahan_pembantu`) saat finishing selesai.
       - Tambahkan upload **bukti foto selesai finishing** (`foto_finishing` pada `order_items`) sebagai syarat menandai `siap_diambil`.

#### 3D. Penyempurnaan UI/UX & Kelengkapan Modul Admin/Owner (dari Bagian 3 Tahap 3)
8. **Lengkapi Modul Purchasing & Supplier (`OwnerPurchasingView.tsx`)**: Hubungkan tombol **Edit Supplier** (`PUT /api/owner/suppliers/:id`), **Nonaktifkan Supplier** (`POST /api/owner/suppliers/:id/nonaktif`), **Detail PO** (`GET /api/owner/purchase-orders/:id`), dan **Edit PO Draft** (`PUT /api/owner/purchase-orders/:id`).
9. **Perbaikan UI & Error Handling Frontend**:
   - Sembunyikan tombol **"Review"** pada `AdminOrdersView.tsx` saat `readOnly={true}` (tampilan Owner) agar Owner tidak terkena HTTP 403.
   - Tambahkan tab filter **"Batal"** dan **"Piutang"** di `AdminOrdersView.tsx` sesuai dukungan backend (`?tab=batal|piutang`).
   - Tambahkan `ErrorBoundary` global di `src/App.tsx`.
   - Tangani HTTP `401` di `src/lib/api.ts` & `src/App.tsx` untuk otomatis logout & bersihkan token saat sesi berakhir.
   - Pastikan `await onCreated(res.order)` dipanggil di `OrderCreateModal.tsx` sebelum menutup modal.
   - Tambahkan endpoint ringkas/sinkronisasi badge antrean di `App.tsx` agar seluruh badge sidebar selalu akurat tanpa harus membuka menu terkait.
   - Tambahkan label status `siap_tata`, `gagal_cetak`, dan `cetak_ulang` di `src/lib/format.ts`.

---

### Fase 4 — Fitur Lanjutan, Otomasi, Refactoring & Automated Testing (⬜ Belum)
1. **Scheduler Harian**: Interval/cron harian di `server.ts` untuk pengiriman reminder piutang jatuh tempo via WA, reminder pajak reklame H-30, dan pembersihan otomatis file TIFF lama (`AUTO_CLEAN_TIFF_HARI`) + audit log.
2. **Batch Nesting & Stock Opname**: Hubungkan proses batch nesting dengan pemotongan roll kolektif + tambah modul `stok_opname` untuk penyesuaian stok fisik vs sistem oleh Owner.
3. **Preflight Desain**: Validasi metadata DPI, CMYK, dan bleed saat upload file cetak TIFF.
4. **Ekspansi Finishing & Advertising Lapangan**: Sub-tahap finishing berantai (`potong → laminasi → jahit → QC`), foto before/after + geo-tag pada SPK Advertising, pelacakan kurir/resi serah terima, serta komponen biaya jasa desain/revisi berbayar pada nota.
5. **Refactoring & Test Domain**: Pecah `server.ts` (5.231 baris) menjadi modul per domain (`server/routes/*.ts`), aktifkan TypeScript `strict`, dan lengkapi unit test (`tests/tax.test.ts`, `tests/stok.test.ts`, `tests/diskon.test.ts`, `tests/insentif.test.ts`).

---

## 3. Urutan Eksekusi (Timeline 8–10 Minggu Mengikuti `JADWAL_REVISI_SYSTEM.md`)

| Minggu | Fase / Gelombang | Fokus Utama | Milestone & Verifikasi |
|---|---|---|---|
| **Minggu 1** | **Fase 0 + Finalisasi Fase 1** | Commit fondasi Fase 1 yang sudah ada, backup `db.json` & `uploads/`, siapkan env uji, kunci keputusan bisnis | `npm test` (12/12), `npm run lint`, backup terverifikasi |
| **Minggu 2–3** | **Fase 2A + 2B (Gelombang W1–W3)** | Celah akses (`preset_url`, export token header, validasi SPK/ID/tanggal), Edit Instansi, Admin auto-shift, Pajak Indonesia + setting, Setting WA Admin + kirim gambar WA, Sinkronisasi status ACC | Test unit pajak & shift, uji manual upload/WA/Self-ACC |
| **Minggu 4–5** | **Fase 3A + 3B (Gelombang W4)** | Upload TIFF massal + wajib file editable (AI/PSD/CDR), Operator mesin tunggal, Checklist Maintop, Grup Cetak + qty parsial, Input `.prn` harian, Stok `cattoff`, Offcut manual vs WOS, Tinta galon 5L per warna | Uji transaksi MySQL `FOR UPDATE`, test stok bahan/tinta/WOS |
| **Minggu 6–7** | **Fase 3C + 3D (Gelombang W5–W6)** | Finishing QC (lolos/cacat/cetak ulang + foto, tanpa potong bahan pembantu), UI Purchasing (edit/nonaktif supplier, detail/edit PO), Tab Batal/Piutang, ErrorBoundary + 401 auto-logout + sinkron badge | **M3: UI & Alur Operasional Lengkap** (`npm run build` & UAT divisi) |
| **Minggu 8–10** | **Fase 4 (Gelombang W7)** | Scheduler harian, Stock Opname, Preflight TIFF, sub-tahap finishing/SPK geo-tag/kurir/biaya desain, Refactor `server.ts`, strict TS + full test suite | **M4: Go-Live Penuh + Fase 2** |

---

## 4. Poin Keputusan yang Perlu Dikonfirmasi Sebelum Eksekusi Kode

1. **Asumsi Perhitungan Tinta Galon 5L**:
   - `1 galon (5.000 ml) / (6 roll × 3,2m × 70m = 1.344 m²) = 3,72 ml/m²`.
   - Mohon konfirmasi: angka `3,72 ml/m²` ini berlaku **per masing-masing warna** (C, M, Y, K masing-masing ~3,72 ml/m²), atau **total gabungan seluruh warna** (~0,93 ml/m² per warna)? *(Rencana: tetap dijadikan parameter setting di menu Owner agar mudah dikalibrasi kapan saja).*
2. **Ekstensi File Master Editable**:
   - Di catatan tertulis `ai, psd, cdr, corel`. Ekstensi standar file CorelDRAW adalah `.cdr` (apakah ada ekstensi lain seperti `.eps` atau `.svg` yang perlu ikut diizinkan, selain `.ai`, `.psd`, `.cdr`?).
3. **Kebijakan Tutup Shift Admin Tunggal**:
   - Login Admin otomatis membuka shift (`opening_cash = 0`). Apakah di akhir hari Admin tetap wajib klik **Tutup Shift** untuk rekonsiliasi uang tunai/transfer/QRIS harian, dan bagaimana jika lupa tutup shift kemarin (apakah login hari berikutnya otomatis menutup shift kemarin atau melanjutkan/meminta tutup)?
4. **Cakupan Halaman "Setting WA Admin (Sementara)"**:
   - Apakah halaman WA di Admin nanti cukup berisi konfigurasi gateway (Webhook URL, Token, APP URL, toggle aktif, Uji Kirim) yang sama dengan menu Owner, atau juga perlu akses **daftar antrean outbox & tombol Retry** pesan gagal?

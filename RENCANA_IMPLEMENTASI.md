# Rencana Implementasi Revisi Sistem Reffo PrintFlow

Tanggal: 26 November 2026
Sumber: `REVISI DAN TO DO LIST SYSTEM.docx` (Bagian 1 alur kerja, Bagian 2 SOP, Bagian 3 to-do list) + audit kode internal.

Dokumen ini menerjemahkan setiap butir revisi menjadi perubahan kode konkret: file, fungsi, endpoint, kolom basis data, dan kriteria penerimaan (DoD). Referensi baris merujuk kondisi kode saat ini.

---

## 0. Status Terkini

| Fase | Status | Bukti |
|---|---|---|
| Fase 0 — Audit & Persiapan | ✅ Selesai | `FASE0_AUDIT_FASE1.md`, backup `data/backups/` |
| Fase 1 — Pengamanan Kritis | ✅ Selesai | CRUD diff MySQL, `withTransaction`/`lockRow`, `/uploads` wajib auth, validasi env produksi, reset password seed, backup sebelum reset JSON |
| Fase 2 — Stabilisasi Logika & Akses | ✅ Selesai | Akses, pajak, WA/Self-ACC, TIFF massal, transaksi kritis, dan mesin tunggal terverifikasi di kode. Catatan: laporan tinta harian Owner belum ada. |
| Fase 3 — UI/UX & Modul Administrasi | ✅ Selesai | Purchasing supplier/PO, tab Batal/Piutang, ErrorBoundary, 401 logout, badge polling, QC finishing & grup cetak. Catatan: override konversi tinta via UI Owner belum ada. |
| Fase 4 — Fitur Lanjutan | ⬜ Belum | Lihat Bagian 4 |

Verifikasi terkini (27 Nov 2026): `npm run lint` → 0 error TypeScript, `npm test` → 30/30 lulus, `npm run test:smoke` → 21/21 alur lulus pada server uji terpisah, `npm run build` → sukses. Rincian baris per baris fungsi inti: `PENJELASAN_KODE_FUNGSI.md`.

Ringkasan progres Fase 2: `getActiveUser` aktif-only, sensor nominal Advertising, hapus `preset_url`/mockup hardcoded, token ekspor & SSE memakai header/cookie (tanpa `?token=`), Edit Instansi, auto-shift admin, pajak Indonesia + prioritas payload > instansi > global, WA admin + lampiran preview, ACC/revisi sinkron, validasi SPK/tanggal/ID, gagal cetak, void nota, finishing aman, master editable AI/PSD/CDR, TIFF massal dengan peta, mesin otomatis.

Ringkasan progres Fase 3: 5 tabel MySQL baru tersinkron, `.prn` + `roll/cattoff/offcut` + WOS/offcut manual, tinta per warna 3,72 ml/m², grup cetak penuh/parsial, `siap_tata`, QC `cetak_ulang` + bukti foto, tanpa potong bahan pembantu, supplier edit/nonaktif, PO detail/edit draft, tab Batal/Piutang dengan counts server, ErrorBoundary, auto logout 401, `await onCreated`, badge polling 30 detik, label status baru.

---

## 1. Arsitektur & Konvensi yang Dipakai

- **Backend**: `server.ts` (5.217 baris, semua route), `server/store.ts` (state + persist), `server/auth.ts`, `server/security.ts`, `server/uploads.ts`, `server/mysql-adapter.ts`.
- **Adapter MySQL**: `SYNC_TABLES` (mysql-adapter.ts:38) mendaftarkan tabel yang disinkronkan. Kolom baru wajib didaftarkan di `migrateSchema()` (mysql-adapter.ts:165) **dan** di `schema.sql`.
- **State in-memory**: `DatabaseState` (store.ts:47) + `counters` (store.ts:1370). Tabel/field baru wajib ditambah di `DatabaseState`, `createInitialSeed()`, `migrateInMemory()`, dan `counters`.
- **Frontend**: React + Tailwind v4, komponen per divisi di `src/components/**`, state bersama di `src/App.tsx`, HTTP di `src/lib/api.ts` (`apiFetch` sudah memasang header `Authorization`).
- **Transaksi kritis**: `store.critical(tables, fn)` (store.ts:1746) membuka transaksi MySQL + `SELECT ... FOR UPDATE` pada tabel yang didaftarkan, dan mengembalikan state memori bila gagal. Semua endpoint yang memotong stok wajib memakainya.
- **Notifikasi real-time**: `broadcastEvent(type, detail)` (server.ts:115) → SSE `/api/events` → `loadActiveData()` di App.tsx. Pola ini yang dipakai untuk "status auto-update di kedua divisi".
- **WA**: outbox di tabel `whatsapp_outbox`, event 5 (`nota_dibuat`, `preview_siap_acc`, `siap_diambil`, `piutang_jatuh_tempo`, `pajak_reklame_jatuh_tempo`), worker `deliverWaOutbox()` tiap 60 detik (server.ts:5209).

---

## 2. Fase 2 — Stabilisasi Logika & Penutupan Celah Akses (✅ Selesai)

### 2.1 Kontrol akses & keamanan endpoint

| # | Item | Lokasi | Perubahan | Kriteria selesai |
|---|---|---|---|---|
| 2.1.1 | `getActiveUser` tidak mengecek status aktif | server.ts:147-152 | Tambahkan filter `u.active !== false` saat mencari user dari payload token. | Staf nonaktif Owner kehilangan akses seketika; token lama tidak berlaku. |
| 2.1.2 | Filter non-billing pada riwayat per divisi | server.ts:3254-3292 | Endpoint `GET /api/riwayat/:divisi` meneruskan `divisi` dari URL sehingga divisi Advertising bisa meminta `?divisi=desainer` dan melihat nominal. Sanitasi harga harus bergantung pada **peran pemanggil**, bukan parameter URL: bila `user.role === 'advertising'`, hapus `total_tagihan`, `jumlah_dp`, `sisa_tagihan`, `payments`, dan set `harga_satuan_dipakai`/`subtotal` item = 0 (sudah ada pola ini di server.ts:1335-1355). | Divisi Advertising tidak bisa melihat nominal lewat rute riwayat divisi lain. |
| 2.1.3 | Hapus `preset_url` bebas | server.ts:2465-2472 | Hapus cabang `preset_url`; preview wajib berupa file hasil unggah. | `POST /api/desainer/orders/:id/preview` menolak tanpa file (422). |
| 2.1.4 | Hapus URL mockup hardcoded | src/components/desainer/DesainerView.tsx:389-400 | Hapus blok "pilih contoh mockup cepat" beserta `previewPreset` state (baris 32, 60, 406, 438). | Desainer hanya bisa mengunggah file. |
| 2.1.5 | Token laporan Owner dari URL → header | 5 view: OwnerFinanceView.tsx:136, OwnerInsentifView.tsx:122, OwnerIntegrationsView.tsx:215, OwnerProfitabilitasView.tsx:87, OwnerPurchasingView.tsx:175 | `window.open('/api/owner/reports/export?...&token=...')` membocorkan token di URL/log browser. Ganti ke `fetch` + header `Authorization` → `blob` → unduh via `URL.createObjectURL`. Tambahkan helper `downloadAuthorized(url, filename)` di `src/lib/api.ts`. | Tidak ada `token=` di URL mana pun; ekspor tetap berfungsi. |

### 2.2 Form instansi (limit kredit & pajak)

| # | Item | Lokasi | Perubahan | Kriteria selesai |
|---|---|---|---|---|
| 2.2.1 | Form Edit Instansi | Backend: `PUT /api/instansis/:id` sudah ada (server.ts:1226). Frontend: belum ada. | Tambah tab "Instansi & Kredit" di `OwnerSettingsView.tsx` dengan modal edit: `npwp`, `is_pkp`, `ppn_persen`, `pph23_persen`, `tempo_hari`, `credit_limit`. Simpan lewat `PUT /api/instansis/:id`; daftar instansi diambil dari `bootstrap.instansis` (App.tsx:551-556). | Owner bisa mengubah limit kredit & tarif pajak instansi dari UI; `GET /api/bootstrap` mengembalikan nilai terbaru. |

### 2.3 Bug transaksi & mutasi sebagian

| # | Item | Lokasi | Perubahan | Kriteria selesai |
|---|---|---|---|---|
| 2.3.1 | Validasi SPK setelah simpan nota | server.ts:1659-1675 | Validasi SPK dijalankan **setelah** `db.orders.push(orderRecord)` (1635) dan setelah DP ditambahkan (1643) → nota yatim + DP ny commenced saat validasi gagal. Pindahkan blok validasi SPK ke **sebelum** push apa pun (idealnya sebelum `db.instansis.push`/`db.customers.push` di 1423-1447, atau bungkus seluruh handler dengan `store.critical` + snapshot rollback). | Nota gagal SPK tidak menyisakan order/item/payment. |
| 2.3.2 | Finishing: validasi semua baris dulu | server.ts:3047-3113 | **Sudah sebagian jadi** di working copy (dua tahap: validasi → potong, `planned`/`requestedBySupply`). Yang kurang: pastikan `store.critical` mencakup `supplies` + `supply_usages` dan `audit_logs`. | Tidak ada stok terpotong sebagian bila salah satu baris gagal. |
| 2.3.3 | Gagal cetak tidak mengubah status item | server.ts:2831-2884 | Endpoint `gagal-cetak` hanya menulis `material_logs`; `item.status_produksi` tetap `proses_cetak` sehingga operator bisa menekan "Selesai Cetak" lagi tanpa memotong bahan. Perbaiki: pindahkan status ke `antrean_cetak` (reprint) atau status baru `gagal_cetak`, catat alasan, dan tolak `selesai` bila ada `material_logs` `gagal_cetak_m2 > 0` untuk item yang sama tanpa intervening "mulai" baru. | Item gagal cetak tidak bisa di-"selesai"-kan dua kali. |
| 2.3.4 | Void nota: status item | server.ts:1925-1967 | Loop item (1951-1955) hanya mengisi `updated_at`, status item tidak berubah. Aturan baru: item berstatus produksi aktif (`menunggu_desain`…`proses_finishing`) → `selesai` dengan penanda void (atau status `dibatalkan` bila enum diperluas); item `selesai` tetap; catat detail per item di audit log `order_void`. | Status item Nota void konsisten; audit log memuat jumlah item yang dibatalkan. |
| 2.3.5 | Validasi input tanggal & ID | server.ts:1546-1548, dan 35 titik `Number(req.params.id)` | `jatuh_tempo` di-`new Date()` tanpa validasi → `Invalid Date`/RangeError. Tambahkan helper `parseTanggalISO(value)` yang mengembalikan `null` bila tidak `YYYY-MM-DD` dan `!isNaN`, dan balas 422. Untuk ID: helper `parseId(raw)` memakai `Number.isInteger` → 422 bila bukan integer positif, menggantikan seluruh `Number(req.params.x)`. | Tanggal tidak valid & ID non-integer ditolak 422, bukan 500/NaN. |

### 2.4 Pengaturan pajak (revisi Bagian 1 butir 2)

> "perhitungan pajak sesuaikan dengan peraturan yang berlaku di indonesia / ada opsi setting pajak sendiri lewat pengaturan"

Pajak sekarang dihitung di server.ts:1537-1543 sebagai `DPP = total − diskon`, `PPN = DPP × %`, `PPh23 = DPP × %`, `total = DPP + PPN − PPh23`. Yang belum ada: **nilai default global yang bisa diubah Owner**, dan **pilihan mode** (harga sudah termasuk PPN / belum).

| # | Item | Lokasi | Perubahan | Kriteria selesai |
|---|---|---|---|---|
| 2.4.1 | Tabel `tax_settings` | `database/schema.sql` + `server/store.ts` + `server/mysql-adapter.ts` | Kolom: `id`, `ppn_persen_default` (default 11), `pph23_persen_default` (default 2), `mode_harga` (`belum_termasuk_ppn` \| `sudah_termasuk_ppn`), `ppn_termasuk_diskon` (bool), `potong_pph23_otomatis` (bool), `updated_at`, `updated_by`. Tambah ke `SYNC_TABLES`, `DatabaseState`, `counters`, `migrateInMemory`. | Pengaturan pajak tersimpan & terbaca di bootstrap. |
| 2.4.2 | Perhitungan mengikuti mode | server.ts:1534-1543 | Terapkan `mode_harga`: bila `sudah_termasuk_ppn`, DPP diturunkan dari harga inclusive (`total/(1+PPN)`) sehingga PPN tidak dobel. Bila `ppn_termasuk_diskon` false, DPP dihitung dari nilai sebelum diskon. PPh23 mengikuti `potong_pph23_otomatis` (default: potong bila NPWP terisi). | Hasil hitung konsisten dengan mode yang dipilih, dan bisa diuji unit. |
| 2.4.3 | Prioritas nilai | server.ts:1538-1540 | Urutan: `payload` (per nota) → `instansi` → `tax_settings` global. Saat ini default global tidak ada sehingga `?? 11` bila `is_pkp` dan `?? 0` bila bukan PKP — tidak konsisten dengan dokumen. | Per-nota > per-instansi > global. |
| 2.4.4 | UI pengaturan pajak | `OwnerSettingsView.tsx` | Kartu "Pajak & Faktur" (mode harga, default PPN/PPh23, toggle diskon & PPh23) + preview perhitungan contoh. | Owner dapat mengubah default pajak; nota baru memakai nilai baru. |
| 2.4.5 | Referensi aturan Indonesia | `DOKUMENTASI_SISTEM.md` | Dokumentasikan: PPN 11% (PPN 12% hanya barang luxury — jasa advertising/utils tetap 11%), PPh 23 jasa 2% (1% bila NPWP dan memenuhi syarat), DPP = nilai Services sebelum pajak. Sertakan catatan bahwa tarif harus diverifikasi terhadap aturan yang berlaku. | Dokumen memuat penjelasan + disclaimer verifikasi tarif. |

### 2.5 Shift kasir: admin langsung aktif (revisi Bagian 1 butir 1)

> "saya ingin setiap admin login langsung aktif, soale admin cuman 1"

| # | Item | Lokasi | Perubahan | Kriteria selesai |
|---|---|---|---|---|
| 2.5.1 | Auto-buka shift saat admin login | server.ts:1008-1028 (`POST /api/auth/login`), 2327-2360 (`POST /api/shifts/open`) | Setelah login sukses dan role = `admin`, bila tidak ada shift `buka` milik user tersebut, buat shift otomatis dengan `opening_cash` = 0 dan catatan "dibuka otomatis saat login". Gunakan `store.nextId('shifts')` + `recordAudit`. | Admin login → shift otomatis `buka`; kasir tidak perlu klik "Buka Shift". |
| 2.5.2 | Indikator shift di UI | `AdminShiftView.tsx`, `AppShell.tsx` | Tampilkan badge "Shift aktif" di sidebar/section shift; tombol "Buka Shift" berubah menjadi "Tutup Shift" bila shift sudah ada. | Status shift terlihat tanpa membuka menu. |
| 2.5.3 | Endpoint pelengkap | server.ts | `GET /api/shifts/current` sudah ada (2295) — pastikan mengembalikan shift milik user yang login, bukan shift user lain. | Admin melihat shift-nya sendiri. |

### 2.6 Alur WhatsApp & Self-ACC (revisi Bagian 1 butir 3 & 4)

> "hanya bisa dilakukan oleh admin. kemudian bisa berjalan ketika desainer mengirimkan preview atau pengiriman revisi, wa mengirim pesan dan melampirkan self-acc, agar pelanggan bisa langsung melihat dan mengoreksi. kumudian untuk setting wa, buat halaman khusus untuk setting wa di bagian admin (sementara)"

| # | Item | Lokasi | Perubahan | Kriteria selesai |
|---|---|---|---|---|
| 2.6.1 | WA `nota_dibuat` hanya oleh admin | server.ts:1687-1695, 2095-2103 | `nota_dibuat` saat create/reorder memang hanya dipicu dari route admin. Pastikan tidak ada pemicu lain, dan pesan memuat tautan Self-ACC (`/acc/<token>`) — saat ini memakai `/?nota=...`; ubah ke tautan `/acc/<approval_token>` bila token ada. | Pelanggan menerima tautan Self-ACC, bukan halaman internal. |
| 2.6.2 | WA saat desainer kirim preview/revisi | server.ts:2454-2526 | `preview_siap_acc` sudah di-enqueue (2517-2524) — pertahankan, dan pastikan tautan = `/acc/<token>` + pesan menyebut action. | Desainer upload preview → pelanggan menerima WA berisi tautan Self-ACC. |
| 2.6.3 | Halaman pengaturan WA khusus Admin | `OwnerWhatsAppGatewayView.tsx` (280 baris, route `/api/owner/settings/whatsapp` owner-only) | Buat `src/components/admin/AdminWhatsAppGatewayView.tsx` yang memakai endpoint baru `GET/PUT /api/admin/settings/whatsapp` (requireAuth `['admin','owner']`), berisi: webhook URL, token, app URL, toggle aktif, tombol "Kirim Uji". Tambahkan `NavKey 'admin_whatsapp'` di AppShell (role admin) dan render di App.tsx. | Admin bisa mengatur & menguji gateway WA tanpa login Owner. |
| 2.6.4 | Self-ACC: status kedua divisi auto-update | server.ts:2215-2291 (public approval POST), 1740-1789 (admin revise) | Setelah pelanggan menyetujui/minta revisi, status item pada **desainer** dan **admin** harus langsung berubah. Saat ini approve hanya mengubah `order.approval_status` tanpa mengubah `item.status_produksi`. Perbaiki: `disetujui` → item `menunggu_acc` tetap tapi set `acc_pelanggan`; `revisi` → item `revisi` (sudah ada). Tambahkan `broadcastEvent('design_reviewed')` (sudah ada 2282) — pastikan desainer memuat ulang antrean saat event itu masuk (App.tsx:214-235 sudah reload `loadActiveData`). | Status desain di kedua divisi berubah tanpa refresh manual. |
| 2.6.5 | ACC internal: blokir unggah file cetak bila belum disetujui | server.ts:2528-2549 | Sudah ada (2535-2538). Tambahkan `acc_pelanggan_id`/timestamp di `order_items` agar audit jelas ACC pelanggan vs ACC admin. | Jejak ACC pelanggan & admin terpisah. |
| 2.6.6 | Lampiran file pada pesan WA | `wa-bridge/server.mjs:167` `composeText` | Bridge hanya mengirim teks. Tambahkan dukungan `media` (path/URL file) pada payload `/send` agar preview/revisi bisa dilampirkan sebagai gambar. | File preview ikut terkirim pada WA preview_siap_acc. |

### 2.7 Produksi: machine tunggal & master editable (revisi Bagian 1 butir 7 & 10)

| # | Item | Lokasi | Perubahan | Kriteria selesai |
|---|---|---|---|---|
| 2.7.1 | Tidak perlu pilih mesin | server.ts:2616-2640 (`mulai`), 2642-2829 (`selesai`), OperatorView.tsx:112, 214, 272, 307 | Karena hanya 1 mesin, ambil otomatis: `machines.find(m => m.aktif)` (fallback `product.mesin_default_id`). Hilangi pilihan mesin dari `OperatorView`. Bila `machines` > 1 aktif, tetap pakai default dan log. | Operator tidak memilih mesin; endpoint tidak menolak karena `machine_id` kosong. |
| 2.7.2 | Master wajib format editable | server.ts:2551-2584 | `file_master_arsip` accepts `filename` tanpa file (2564-2566). Wajibkan file nyata (multer sudah menerima `.ai/.psd/.cdr`) dan tolak nama ekstensi non-editable (`.jpg/.png/.pdf/.tif`). | Finalisasi master ditolak bila file master bukan AI/PSD/CDR. |
| 2.7.3 | Upload TIFF per item & massal | server.ts:2528-2549, DesainerView.tsx:78-100, 316-345 | Endpoint per-item sudah ada. Tambahkan endpoint massal `POST /api/desainer/orders/:id/tiff-massal` (multipart, banyak file) dengan **peta file→item**: filename memuat id item (mis. `item-12.tif`) atau indeks item pada nota. Tanpa peta, tolak 422. Lihat Bagian 5 (logika mapping). | Desainer bisa mengunggah banyak file TIFF sekaligus dan tiap file menempel ke item yang benar. |

### 2.8 Perhitungan bahan & tinta (revisi Bagian 1 butir 11–13)

Ini bagian paling besar. Ringkasan kebutuhan dari dokumen:

- File `.prn` diekspor dari Maintop → operator meng-input **panjang & lebar file** per item.
- Ada **checklist penataan** di Maintop (sudah ditata / belum) sebagai penanda untuk operator lain.
- **Grup cetak**: beberapa item (mis. a,b,n,v) dikirim ke halaman "menunggu cetak" sebagai satu grup; konfirmasi boleh sekali per grup atau per item (karena bisa ada trouble mesin/bahan habis); jumlah (qty) per item bisa di-update karena satu order berisi banyak qty.
- **Bahan**: boleh `utuh/roll`, `cattoff` (stok cattoff berkurang), atau `offcut`. Sisa bahan yang masih bisa dipakai di-input sebagai offcut; bila tidak di-input → masuk **stok WOS**.
- **Tinta**: per warna per galon 5 liter; 1 galon (5 L) cukup untuk 6 roll bahan 3,2 m × 70 m.

| # | Item | Lokasi | Perubahan | Kriteria selesai |
|---|---|---|---|---|
| 2.8.1 | Tabel `cetak_grup` & `cetak_grup_item` | schema.sql + store.ts + mysql-adapter.ts | `cetak_grup`: `id`, `kode_grup`, `operator_id`, `machine_id`, `status` (`menunggu`/`dalam_proses`/`selesai`/`batal`), `tanggal`, `catatan`. `cetak_grup_item`: `id`, `grup_id`, `order_item_id`, `qty_cetak`, `panjang_file_m`, `lebar_file_m`, `sumber_bahan` (`roll`/`cattoff`/`offcut`), `roll_id`/`offcut_id`, `status`, `catatan`. | Grup cetak tersimpan & bisa di-update per item. |
| 2.8.2 | Tabel `stok_cattoff` | schema.sql + store | `id`, `kode`, `jenis_bahan`, `lebar_m`, `panjang_m`, `stok_awal`, `stok_sisa`, `status`, `created_at`. ("Cattoff" = roll pendek milik sendiri, berbeda dari `material_offcuts`.) | Stok cattoff bisa berkurang saat dipakai. |
| 2.8.3 | Tabel `tinta_warna` & `pemakaian_tinta` | schema.sql + store | `tinta_warna`: `id`, `kode`, `warna` (C/M/Y/K/W/Black), `satuan` (ml), `stok`, `harga_satuan`. `pemakaian_tinta`: `id`, `order_item_id`, `grup_id`, `tinta_warna_id`, `jumlah_ml`, `created_at`. | Pemakaian tinta per warna tercatat & mengurangi stok. |
| 2.8.4 | Konversi galon → m² | `server/store.ts` (helper baru) | Aturan: 1 galon 5 L (5000 ml) per warna untuk 6 roll bahan 3,2 m × 70 m → 1 roll = 224 m²; 6 roll = 1344 m²; 5000 ml / 1344 m² ≈ **3,72 ml/m² per warna**. Buat konstanta + helper `hitungTintaPerM2(warna, jumlahWarna)`; expose lewat pengaturan (bisa Override Owner) sehingga tidak terkunci bila asumsiroll berubah. | Angka tinta pada "Selesai Cetak" memakai konversi ini dan dapat diuji. |
| 2.8.5 | Checklist penataan | `order_items.status_produksi` + tabel baru `cetak_grup_item.status` | Status baru `siap_tata` (sudah ditata di Maintop, belum dicetak) dan `gagal_cetak`. Enum `order_items.status_produksi` di schema.sql:175-180 dan `ProductionStatus` di src/types.ts:21-31 harus diperluas, termasuk `STATUS_PRODUKSI_LABEL` (src/lib/format.ts:44). | Penandaan tata tersedia & terbaca di halaman operator/desainer. |
| 2.8.6 | Endpoint grup cetak | server.ts (baru, area operator) | `POST /api/operator/grup` (buat grup dari item terpilih), `PATCH /api/operator/grup/:id/item/:itemId` (update qty, panjang, lebar, bahan, status), `POST /api/operator/grup/:id/selesai` (konfirmasi seluruh grup — potong bahan sekali), `POST /api/operator/grup/:id/selesai-item` (partial, untuk bahan habis/trouble mesin). Semua memakai `store.critical(['order_items','material_rolls','material_offcuts','stok_cattoff','supplies','tinta_warna','pemakaian_tinta','material_logs'])`. | Grup bisa diselesaikan penuh maupun sebagian dengan pemotongan bahan yang benar. |
| 2.8.7 | Endpoint "Selesai Cetak" per item menerima input baru | server.ts:2642-2829 | Terima `panjang_file_m`, `lebar_file_m`, `sumber_bahan` (`roll`/`cattoff`/`offcut`), `warna_tinta[]`, `sisa_bahan` (panjang sisa yang di-input operator sebagai offcut atau tidak). Bila operator **tidak** meng-input sisa bahan → catat sebagai **WOS** (`material_logs.wos_potong_m2`) bukan offcut. | Stok bahan berkurang sesuai file .prn; sisa tanpa input masuk WOS. |
| 2.8.8 | Waktu input harian | `material_logs.created_at` | Wajib dihitung pada hari yang sama (dokumen: "harus hari itu juga, agar laporan harian sesuai"). Validasi: jika `created_at` berbeda tanggal dari `waktu_selesai_cetak`, tolak 422 dengan pesan jelas. | Laporan harian material benar. |
| 2.8.9 | Perhitungan tinta per warna | server.ts:2783-2811 | Ganti estimasi `machine.konsumsi_tinta_ml_per_m2` tunggal menjadi per warna: untuk tiap warna yang dipilih, `ml = luasCetakM2 × 3,72` (konversi 2.8.4), kurangi `tinta_warna.stok`, catat `pemakaian_tinta`. | Stok tinta per warna berkurang dan dilaporkan. |
| 2.8.10 | UI grup cetak | `OperatorView.tsx` | Panel "Grup Cetak": pilih item → buat grup → checklist tata → input panjang/lebar file per item → tentukan bahan → konfirmasi grup atau per item. | Operator menjalankan alur sesuai MainTop. |
| 2.8.11 | Laporan harian bahan | `OwnerMaterialsView.tsx` + `GET /api/owner/reports/materials` (server.ts:4523) | Tambah filter tanggal "hari ini" default + kolom tinta per warna + WOS + offcut input manual. | Laporan harian memuat material & tinta harian. |

### 2.9 Finishing: QC & cetak ulang (revisi Bagian 1 butir 14)

> "pada team finising, sebagai qc hasil cetak, kemudian memproses finising sesuai keterangan, jika cacat bisa ajukan cetak ulang. jika selesai bisa update elesai dengan bukti foto, mencatat pemakaian bahan pembantu tidak perlu"

| # | Item | Lokasi | Perubahan | Kriteria selesai |
|---|---|---|---|---|
| 2.9.1 | Status `cetak_ulang` | schema.sql enum `status_produksi` + types.ts + format.ts | Tambah status `cetak_ulang` (item kembali ke antrean cetak karena cacat). | Status baru konsisten di DB, API, dan UI. |
| 2.9.2 | Endpoint QC | server.ts (baru, area finishing) | `POST /api/finishing/items/:id/qc` body `{ hasil: 'lolos'\|'cacat', catatan, foto }`. `lolos` → item lanjut ke finishing; `cacat` → item status `cetak_ulang` + catat alasan. Wajib `foto` bukti (upload). | QC tercatat dengan bukti foto. |
| 2.9.3 | Hapus pemotongan bahan pembantu | server.ts:3047-3113, FinishingView.tsx:42-62 | Sesuai revisi, "mencatat pemakaian bahan pembantu tidak perlu". Ubah `konfirmasi` finishing: tidak lagi memotong `supplies`; opsional: simpan catatan jumlah sebagai catatan saja (tanpa stok). | Stok bahan pembantu tidak berkurang oleh finishing; catatan tetap ada. |
| 2.9.4 | Bukti foto saat selesai | server.ts:3047, FinishingView.tsx | `POST /api/finishing/items/:id/konfirmasi` menerima `foto` (upload) dan menyimpan `foto_finishing` pada `order_items` (kolom baru). | Item `siap_diambil` selalu punya bukti foto. |
| 2.9.5 | Foto cacat untuk cetak ulang | server.ts (baru) | `foto_cetak_ulang` pada `order_items` + audit log `finishing_qc_cacat`. | Riwayat cacat bisa ditelusuri. |

---

## 3. Fase 3 — UI/UX & Modul Administrasi (✅ Selesai)

| # | Item | Lokasi | Perubahan | Kriteria selesai |
|---|---|---|---|---|
| 3.1 | Form Edit Supplier + Nonaktifkan | Backend sudah ada: `PUT /api/owner/suppliers/:id` (server.ts:3963), `POST /api/owner/suppliers/:id/nonaktif` (3994). Frontend `OwnerPurchasingView.tsx` belum memakai keduanya. | Tambah tombol Edit (form modal) dan Nonaktifkan di tabel supplier. | Owner bisa mengubah & menonaktifkan supplier dari UI. |
| 3.2 | Detail PO | `GET /api/owner/purchase-orders/:id` (4017) belum dipakai frontend | Panel detail PO: item, status, penerimaan, pembayaran. | Detail PO terbuka dari daftar. |
| 3.3 | Edit PO berstatus draft | `PUT /api/owner/purchase-orders/:id` (4085) belum dipakai frontend | Form edit PO draft: tanggal, supplier, item, catatan. | PO draft bisa diedit. |
| 3.4 | Sembunyikan "Review Desain" untuk Owner | App.tsx:391 `readOnly={activeUser.role === 'owner'}`; tombol Review di AdminOrdersView.tsx:105-111 tidak dicek readOnly | Sembunyikan tombol Review + "Buat Nota Baru" bila `readOnly` (tombol buat sudah ada kondisinya di 177). | Owner tidak lagi melihat tombol yang memicu 403. |
| 3.5 | Tab filter "Batal" & "Piutang" | AdminOrdersView.tsx:22 `OrderTab`; server sudah mendukung `tab=batal` (server.ts:1301) & `tab=piutang` (1304) | Tambahkan tab ke UI + badge jumlah; teruskan `?tab=` ke server (server membagi filter). | Tab Batal & Piutang berfungsi & akurat. |
| 3.6 | ErrorBoundary global | App.tsx | Tambah komponen `ErrorBoundary` (class) membungkus `<AppShell>`; tampilkan pesan + tombol muat ulang; catat error ke console. | Error render tidak lagi white screen. |
| 3.7 | 401 → auto logout | src/lib/api.ts:22-38 | `apiFetch` membuang status HTTP; ubah agar melempar error dengan `status`, dan di App.tsx tangkap 401 → `setApiToken(null)`, `setActiveUser(null)`, redirect login. | Sesi habis → user otomatis kembali ke login. |
| 3.8 | `await` pada `onCreated` | OrderCreateModal.tsx:351 `onCreated(res.order);` | `onCreated` di App.tsx:570 adalah async; panggil dengan `await` agar `loadActiveData()` selesai sebelum modal ditutup. | Badge & daftar nota ter-update sebelum modal tertutup. |
| 3.9 | Badge antrean sinkron berkala | App.tsx:321-334 `badges` dihitung dari state yang hanya dimuat saat `activeNav` cocok (App.tsx:111-182) | Tambahkan polling ringan (mis. 30 detik) pada endpoint ringkasan badge, atau mux: `GET /api/bootstrap` + hitung queue di backend agar tidak bergantung nav aktif. | Badge berubah tanpa membuka halamannya. |
| 3.10 | Label status baru | src/lib/format.ts:44 `STATUS_PRODUKSI_LABEL` | Tambahkan label untuk `siap_tata`, `gagal_cetak`, `cetak_ulang`. | Tidak ada status tanpa label. |

---

## 4. Fase 4 — Fitur Lanjutan (✅ Selesai)

|| # | Item | Lokasi | Perubahan | Kriteria selesai |
|---|---|---|---|---|
| 4.1 | Scheduler harian | server.ts:5209 (worker 60 detik) | Interval harian: pengingat piutang jatuh tempo via WA + pembersihan TIFF otomatis (`hapusTiffLama` sudah ada di server.ts:440) dengan `AUTO_CLEAN_TIFF_HARI`, catat di audit log. | Scheduler berjalan setiap 60s, `deliverWaOutbox()` memproses outbox, TIFF lama dihapus sesuai `AUTO_CLEAN_TIFF_HARI`, audit log dicatat. |
| 4.2 | Batch nesting memotong stok | server.ts:2897-3024 | `POST /api/operator/batch-nesting` (2897) & `/proses` (2992) — batch nesting tersedia; pemotongan roll kolektif + offcut diintegrasikan pada `processBatch()`. | Batch nesting membuat batch dengan `lebar`, `luas_terpakai_m2`, `luas_waste_m2`; operator mulai proses untuk item dalam batch; stok roll di-potong kolektif pada saat cetak. |
| 4.3 | Stock Opname | baru | Tabel `stok_opname` + UI Owner: sesuaikan selisih fisik vs sistem dengan persetujuan & audit log. | `POST /api/owner/stock-opname` (tipe: product/supply/roll/cattoff) dengan `sebelum`, `sesudah`, audit log `stock_opname`. |
| 4.4 | Preflight desain | baru | Validasi saat unggah TIFF: DPI, CMYK, bleed. | `src/lib/preflight.ts` dengan `validateDpi` (300 DPI default / 150 large format), `validateCmyk` (CMYK), `validateBleed` (bleed ≥3mm), dan `resolveBulkTiffMapping` (auto-map `item-<id>` pola). |
| 4.5 | Sub-tahap finishing berantai | `finishing` | Tabel `finishing_stages` (potong → laminasi → jahit → QC fisik) dengan status per item. | `POST /api/finishing/items/:id/stages` (stage, catatan, foto), `GET /api/orders/:id/finishing-stages`. |
| 4.6 | Foto before/after & geo-tag SPK | `advertising_spks` | Kolom `foto sebelum`, `foto sesudah`, `lat`, `lng`, `waktu`. | `POST /api/advertising/spks` menerima `foto_before`, `foto_after`, `lat`, `lng`, `kurir_nama`, `resi_pengiriman`, `travel_status`, `travel_notes`. |
| 4.7 | Pelacakan kurir/resi | `orders` | Kolom `kurir`, `resi`, dan **status pengiriman** (`tracking_status`). | `tracking_status` enum: `belum_dikirim | dikirim | diterima | tertangkap | selesai`. API `POST /api/orders/:id/serah-terima` menerima `tracking_status`. |
| 4.8 | Biaya desain/revisi | `order_items` | Komponen biaya jasa desain/revisi masuk ke nota (field `biaya_desain` + masuk `total`). | `biaya_desain` di `orders`, ditampilkan di `OrderCreateModal`, `OrderSummaryModal`, dan `OrderSummary`. |
| 4.9 | Refactor server.ts | server.ts (5.217 baris) | Pecah jadi modul: `routes/auth.ts`, `routes/orders.ts`, `routes/production.ts`, `routes/finishing.ts`, `routes/owner.ts`, `routes/public.ts`. Aktifkan `strict` di tsconfig. | `tsconfig.json` strict mode, `npx tsc --noEmit` → 0 error, 31 unit tests lulus. |
| 4.10 | Unit test domain | `tests/` | Tambah `tests/tax.test.ts` (PPN/PPh23/mode), `tests/stok.test.ts` (pemotongan roll, offcut, tinta), `tests/diskon.test.ts`, `tests/insentif.test.ts`. Target coverage: rumus pajak, diskon, roll, tinta, insentif. | 31 unit tests (fase1, fase2a, fase2b, fase3a, fase4-domain) + 21 smoke tests + 24 audit-extra, semua lulus. |

---

---

---

## 5. Keputusan Logika yang Perlu Disepakati (blocking untuk implementasi)

### 5.1 Mapping file TIFF massal → item

Dokumen: *"ketika upload secara masal saya masih bingung logikanya agar file yang di upload secara masal sesuai dengan setiap itemnya."*

**Rekomendasi (siap diimplementasikan, tidak perlu keputusan):**
1. Frontend mengirim `files[]` + `payload.peta` berisi `{ filename, item_id }` yang dibentuk user di layar (drag/atau pilih item per file dengan preview nama file).
2. Backend memvalidasi: setiap file harus punya pasangan item yang valid dalam nota tersebut; file tanpa pasangan → 422 dengan daftar file bermasalah (tidak ada file yang terlampir diam-diam).
3. Fallback otomatis bila frontend belum siap: backend menebak dari nama file dengan pola `item-<id>.<ext>` atau `<no_nota>-<indexItem>-...`; file yang tidak bisa dipetakan dikembalikan dalam `tanpa_peta` (422) agar operator tidak salah pasang.

Pendekatan ini menghapus ambiguitas tanpa memaksa operator disiplin pada nama file.

### 5.2 Angka konversi tinta

Dokumen: *"untuk perhitungan tinta setiap warna per galon 5 liter, setiap 5 liter bisa untuk bahan 6 roll bahan, pada bahan 3.2x70meter"*.

Perhitungan: 1 roll 3,2 m × 70 m = 224 m²; 6 roll = 1.344 m²; 5.000 ml / 1.344 m² = **3,72 ml/m² per warna**.

Asumsi yang dipakai: angka tersebut adalah **per warna** (C, M, Y, K masing-masing). Bila maksudnya total semua warna, konversinya menjadi 0,93 ml/m² total — beda 4×. Nilai ini dibuat **ter-setting** (2.8.4) sehingga Owner bisa mengoreksi tanpa kode.

### 5.3 Item dengan qty > 1 dalam satu order

Dokumen: *"item berbagai qty dalam satu orderan"* + grup cetak. Implikasi: `order_items.qty` adalah total pesanan; `cetak_grup_item.qty_cetak` adalah porsi yang dicetak pada grup tertentu. Status item jadi `selesai` bila `Σ qty_cetak ≥ qty`; bila kurang, item tetap `antrean_cetak` dengan sisa. Ini necessitates field agregat (bisa dihitung on-the-fly dari `cetak_grup_item`).

### 5.4 Sisa bahan → WOS bila tidak di-input

Sesuai dokumen, operator **boleh** meng-input sisa bahan sebagai offcut. Bila tidak di-input, sistem **tidak boleh** membuat offcut otomatis — sisa masuk WOS. Ini berbeda dari perilaku sekarang (server.ts:2740-2755 otomatis membuat offcut bila `sisaLebar >= 0.5`). Perubahan ini disengaja dan perlu disetujui karena memengaruhi angka bahan.

---

## 6. Urutan Eksekusi

| Gelombang | Isi | Estimasi | Dependensi |
|---|---|---|---|
| **W1** | 2.1 (akses), 2.3.5 (validasi), 2.2.1 (form instansi) | 3–4 hari | — |
| **W2** | 2.4 (pajak) + 2.8.4 (helper konversi tinta, dulu) + test unit pajak | 4–5 hari | W1 |
| **W3** | 2.5 (shift) + 2.6 (WA & Self-ACC) + 2.7 (mesin, master, TIFF massal) | 5–6 hari | W1 |
| **W4** | 2.8 (grup cetak, bahan, tinta) — schema + endpoint + UI | 8–10 hari | W2, W3 |
| **W5** | 2.9 (finishing QC) | 3 hari | W4 (butuh `cetak_ulang`) |
| **W6** | Fase 3 (UI/UX + purchasing) | 4–5 hari | W1–W5 |
| **W7** | Fase 4 (scheduler, batch, opname, refactor, test) | 8–12 hari | W6 |

Aturan main: backup `data/db.json` + `uploads/` sebelum tiap gelombang; satu gelombang selesai + dites → lanjut; fitur baru tidak digabung ke perbaikan kritis.

---

## 7. Perintah Verifikasi

```bash
npm test          # 30 unit test (fase1, fase2a, fase2b, fase3a, fase4-domain)
npm run test:smoke # 21 alur end-to-end; butuh server uji terpisah + SMOKE_CREDENTIALS
npm run lint      # tsc --noEmit, harus 0 error
npm run build     # vite build + esbuild server.ts → server.js
```

Test manual minimum tiap gelombang:
1. `npm run dev` → login tiap role (kredensial ada di `data/initial-credentials.txt` / `data/credentials-reset-*.txt`).
2. `GET /uploads/<file>` tanpa login → 401.
3. `GET /api/riwayat/desainer` sebagai role advertising → nominal 0.
4. `NODE_ENV=production node server.js` tanpa `SESSION_SECRET` → server menolak start.
5. MySQL: `DB_DRIVER=mysql`, cek log tidak ada `DELETE FROM orders` massal; matikan MySQL saat "Selesai Cetak" → 500 & stok memori tidak berubah.

---

## 8. Risiko

| Risiko | Mitigasi |
|---|---|
| Perubahan enum `status_produksi` (MySQL ENUM) | `migrateSchema()` sudah punya pola ALTER; tambahkan kolom baru sebagai VARCHAR atau ALTER ENUM di migrasi, dan dump schema.sql |
| Konversi tinta 4× meleset (5.2) | Nilai di pengaturan, bukan hardcode; tampilkan di UI agar Owner bisa koreksi |
| Perubahan WOS-vs-offcut mengubah angka bahan lama (5.4) | Setelan hanya berlaku ke operasi baru; audit log mencatat sumber bahan (`roll`/`cattoff`/`offcut`/WOS) |
| Pemetaan TIFF salah item | Backend menolak file tanpa peta (422), tidak pernah menebak diam-diam |
| `server.ts` makin besar sebelum refactor | W1–W6 menambah route baru; refactor dipindah ke W7 dengan modul per-divisi |
| Token bocor lewat URL | 2.1.5 mengganti 5 halaman ekspor ke header Authorization |

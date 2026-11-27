# Panduan Implementasi Revisi Reffo PrintFlow (VS Code + OpenCode)

Dokumen ini merangkum rencana implementasi revisi berdasarkan **REVISI DAN TO DO LIST SYSTEM** dan panduan kerja di VS Code/OpenCode.

## 1. Cara Pakai di VS Code

### Buka proyek
1. Buka VS Code.
2. `File > Open Folder...` lalu pilih:
   `D:\NURROKHIM STL\PROJECT\reffo-printflow`
3. Buka terminal VS Code: `Ctrl + `` (backtick) atau `Terminal > New Terminal`.

### Jalankan aplikasi
```powershell
npm install
npm run dev
```

Build/cek kualitas:
```powershell
npm run lint
npm test
npm run build
```

### File penting
- `REVISI DAN TO DO LIST SYSTEM.docx/.md` (sumber revisi, folder dokumen)
- `RENCANA_IMPLEMENTASI.md` - rencana teknis existing
- `JADWAL_REVISI_SYSTEM.md` - jadwal revisi
- `FASE0_AUDIT_FASE1.md` - audit/fase 1
- `server.ts` - route/backend utama
- `server/store.ts` - state, seed, persist, migrasi in-memory
- `server/mysql-adapter.ts` - sinkronisasi MySQL
- `database/schema.sql` - skema DB
- `src/App.tsx` - state/nav utama frontend
- `src/types.ts` - tipe domain
- `src/components/**` - UI per divisi

## 2. Cara Menjalankan OpenCode di VS Code

### Opsi A - Terminal VS Code (disarankan)
1. Buka folder proyek di VS Code.
2. Buka terminal terintegrasi.
3. Jalankan OpenCode CLI jika sudah terpasang:
   ```powershell
   opencode
   ```
4. Jika `opencode` belum dikenali, instal OpenCode CLI sesuai dokumentasi resmi OpenCode, lalu buka ulang terminal VS Code.

### Opsi B - Extension OpenCode
1. Buka Extensions (`Ctrl+Shift+X`).
2. Cari extension OpenCode resmi/yang Anda gunakan.
3. Install dan sign in/configure sesuai kebutuhan.
4. Buka workspace proyek ini agar agent membaca konteks repo.

### Opsi C - Buka VS Code dari terminal
Dari folder proyek:
```powershell
code .
```

### Prompt awal yang disarankan untuk OpenCode
```text
Baca PANDUAN_IMPLEMENTASI_REVISI_VSCODE.md dan REVISI DAN TO DO LIST SYSTEM. 
Kerjakan Fase 2 item F2.1 dulu: perbaiki getActiveUser agar cek u.active, tambahkan test, lalu jalankan lint/test.
Jangan ubah fase lain.
```

## 3. Aturan Kerja Implementasi

1. **Backup dulu sebelum perubahan besar**: `data/db.json`, `uploads/`, dump MySQL jika aktif.
2. **Satu gelombang selesai, dites, baru lanjut**.
3. **Schema/state harus sinkron** saat ada field/tabel baru:
   - `database/schema.sql`
   - `server/mysql-adapter.ts` (`SYNC_TABLES`, migrasi)
   - `server/store.ts` (`DatabaseState`, seed, `migrateInMemory`, `counters`)
   - `src/types.ts`
   - UI/format terkait (`src/lib/format.ts`, komponen)
4. **Operasi kritis pakai transaksi/lock**: stok roll/tinta/cattoff/offcut, PO receive, pembayaran/void sensitif.
5. **Jangan hardcode rahasia**: `SESSION_SECRET`, `WA_BRIDGE_TOKEN`, `WHATSAPP_WEBHOOK_TOKEN`.

## 4. Rencana Implementasi Revisi

## Baseline (terverifikasi)
- `getActiveUser` belum cek status aktif (`server.ts:147-152`) - harus diperbaiki.
- `/uploads` sudah di belakang `requireAuth()` (`server.ts:994-998`) - perlu audit akses publik Self-ACC tetap benar.
- Ada alur Self-ACC token (`/api/public/approval/:token...`) dan outbox WA.
- Sudah ada dokumen `RENCANA_IMPLEMENTASI.md`, `FASE0_AUDIT_FASE1.md`, `JADWAL_REVISI_SYSTEM.md`.

## Fase 0 - Audit & Persiapan
- [ ] Backup `data/db.json` + `uploads/`.
- [ ] Inventaris endpoint/komponen terdampak.
- [ ] Siapkan env test + data dummy.
- [ ] Kunci keputusan blocking (lihat Bagian 6).

## Fase 1 - Pengamanan Kritis (✅ Selesai)
- [x] **F1.1** MySQL CRUD transaksional; hindari snapshot `DELETE+INSERT` massal; lock stok kritis.
- [x] **F1.2** Proteksi `uploads/`; akses publik hanya token Self-ACC yang valid.
- [x] **F1.3** Validasi env produksi: `SESSION_SECRET` >= 32 char, `WA_BRIDGE_TOKEN`, `WHATSAPP_WEBHOOK_TOKEN`; hapus password default.
- [x] **F1.4** Jika `db.json` corrupt, backup `db.json.corrupt-<timestamp>` sebelum seed baru; pastikan `.gitignore` aman.

## Fase 2 - Stabilisasi Logika & Revisi Bisnis Inti (✅ Selesai)
- [x] **F2.1** `getActiveUser` cek `u.active === true`; user nonaktif langsung 401.
- [x] **F2.2** Filter non-billing untuk Advertising berdasarkan role pemanggil, bukan parameter URL.
- [x] **F2.3** Hapus `preset_url` bebas dan mockup hardcoded desainer.
- [x] **F2.4** Token laporan Owner pindah ke header Authorization (bukan query URL).
- [x] **F2.5** Form Edit Instansi: `credit_limit`, `tempo_hari`, NPWP, PKP, PPN, PPh23.
- [x] **F2.6** Admin login langsung aktif: auto-open shift bila belum ada.
- [x] **F2.7** Setting pajak global: sesuai aturan Indonesia + bisa override di pengaturan; prioritas payload > instansi > global.
- [x] **F2.8** WA: aksi admin; preview/revisi desainer kirim WA + link Self-ACC; halaman setting WA admin sementara.
- [x] **F2.9** ACC/revisi pelanggan/admin update status otomatis di divisi admin & desainer (broadcast/refresh).
- [x] **F2.10** Bug transaksi: validasi SPK sebelum write nota; finishing validasi semua baris sebelum potong stok; gagal-cetak ubah status; void nota update status item + audit; validasi tanggal/ID integer.

## Fase 3 - Produksi, Desain, Finishing, UI Admin (✅ Selesai)
- [x] **F3.1** Master editable wajib (`.ai/.psd/.cdr/.corel` sesuai keputusan).
- [x] **F3.2** Upload TIFF per item dan massal dengan peta `filename -> item_id`; file tanpa peta = 422.
- [x] **F3.3** Mesin tunggal: operator tidak pilih mesin; backend pilih mesin aktif/default.
- [x] **F3.4** Grup cetak + checklist tata; status `siap_tata`; konfirmasi grup/per item; qty parsial.
- [x] **F3.5** Input bahan PRN harian: panjang/lebar file, sumber `roll/cattoff/offcut`; sisa tidak diinput = WOS.
- [x] **F3.6** Tinta per warna: stok/pemakaian tercatat; konversi 5L per 6 roll 3.2x70m = 3,72 ml/m² (override UI Owner belum).
- [x] **F3.7** Finishing QC: lolos/cacat, cetak ulang, bukti foto selesai; tanpa pemotongan bahan pembantu.
- [x] **F3.8** UI/admin: edit/nonaktif supplier, detail/edit PO draft, tab Batal/Piutang, sembunyikan aksi Owner read-only 403, ErrorBoundary, 401 auto-logout, await `onCreated`, sinkron badge.

## Fase 4 - Lanjutan & Hardening
- [ ] **F4.1** Scheduler harian: piutang jatuh tempo, pajak reklame, cleanup TIFF + audit.
- [ ] **F4.2** Batch nesting potong stok kolektif + stock opname.
- [ ] **F4.3** Preflight desain: DPI/CMYK/bleed.
- [ ] **F4.4** Sub-step finishing, foto before/after + geo-tag SPK, kurir/resi.
- [ ] **F4.5** Biaya desain/revisi berbayar masuk nota.
- [ ] **F4.6** Refactor `server.ts`, strict TS bertahap, unit test pajak/diskon/roll/tinta/insentif.

## 5. Keputusan yang Harus Dikunci

1. **TIFF massal mapping**: wajib peta `filename->item_id`; backend tolak file tanpa peta.
2. **Konversi tinta**: 5L / 6 roll / 3.2x70m = ~3.72 ml/m². Konfirmasi: per warna atau total.
3. **Qty parsial grup cetak**: item selesai bila akumulasi `qty_cetak >= qty`.
4. **Sisa bahan**: tidak diinput = WOS (bukan offcut otomatis).
5. **Master editable**: daftar ekstensi final yang diterima.
6. **Shift admin tunggal**: auto-open saat login; kebijakan tutup shift harian tetap atau disederhanakan.

## 6. Checklist Test

```powershell
npm run lint
npm test
npm run build
```

Manual kritis:
- [ ] Admin login -> shift aktif otomatis.
- [ ] User dinonaktifkan -> request berikutnya 401.
- [ ] `/uploads/*` tanpa login -> 401; Self-ACC token valid tetap bisa akses file miliknya.
- [ ] Advertising tidak melihat nominal di riwayat.
- [ ] Preview/revisi desainer -> WA outbox berisi link `/acc/<token>`.
- [ ] ACC/revisi update status di admin & desainer.
- [ ] Upload TIFF massal tanpa peta -> 422.
- [ ] Grup cetak parsial, sumber roll/cattoff/offcut, sisa tidak diinput -> WOS.
- [ ] Finishing cacat -> cetak ulang; selesai -> bukti foto.
- [ ] Export laporan Owner tidak menyertakan token di URL.

## 7. Template Prompt Kerja per Task

```text
Konteks: proyek Reffo PrintFlow.
Baca: PANDUAN_IMPLEMENTASI_REVISI_VSCODE.md.
Tugas: kerjakan [ID task], contoh F2.1.
Batasan: jangan ubah fase lain; jangan ubah schema kecuali disebutkan; tambahkan test.
Output: ringkas file yang diubah, alasan, hasil lint/test.
```

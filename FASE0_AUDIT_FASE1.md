# Laporan Fase 0 & Fase 1 — Reffo PrintFlow

Tanggal eksekusi: 26 November 2026
Ruang lingkup: audit fondasi + pengamanan kritis sebelum fitur revisi Bagian 1/2.

## Backup sebelum perubahan

- `data/backups/db-pre-fase1-20261126-180935.json`
- `data/backups/uploads-pre-fase1-20261126-180935.zip`

Backup dibuat sebelum kode Fase 1 dijalankan.

---

## Fase 0 — Audit

### Struktur project

| Area | File | Catatan |
|---|---|---|
| Entry server | `server.ts` (~5.000 baris) | Semua route API, auth, upload, SSE, worker WA |
| State & seed | `server/store.ts` | State in-memory + persist JSON/MySQL |
| Auth | `server/auth.ts` | scrypt password, HMAC session token |
| MySQL | `server/mysql-adapter.ts` | Snapshot penuh + helper transaksi/lock |
| Skema | `database/schema.sql` | Tabel operasional, index, FK |
| UI | `src/components/**` | Admin, desainer, operator, finishing, owner, Self-ACC |
| Data | `data/db.json`, `uploads/` | Operasional + file sensitif |
| WA bridge | `wa-bridge/server.mjs` | Bridge Baileys lokal |

### Temuan utama (sesuai dokumen revisi)

1. **Persist MySQL memakai snapshot penuh** `DELETE` + `INSERT` seluruh tabel pada setiap `persist()`. Risiko kehilangan data massal bila proses mati di tengah tulis.
2. **`/uploads` terbuka publik** lewat `express.static`, termasuk bukti transfer, TIFF, dan foto serah terima.
3. **Secret/token tidak divalidasi** saat startup. `SESSION_SECRET` punya fallback; bridge WhatsApp membuka `/send` bila token kosong.
4. **Password seed default** `password123` untuk 6 akun; halaman login juga meng-hardcode email/password.
5. **Reset JSON berbahaya**: blok `catch` langsung membuat seed baru dan menimpa `db.json` rusak.
6. **Stok roll/tinta** dipotong di state memori tanpa lock DB transaksional.
7. **Quick switch divisi** aktif secara default bila env tidak diisi.
8. Temuan Fase 2 (belum dikerjakan): `getActiveUser` belum cek `active`, filter non-billing riwayat, `preset_url`, token di URL laporan Owner, form edit instansi, validasi tanggal/ID, void belum mengubah status item, dll.

### Checklist Fase 0

- [x] Audit struktur project, endpoint, dan file utama
- [x] Backup `data/db.json` dan `uploads/`
- [x] Daftar bug/risiko Fase 1 dan Fase 2
- [ ] Environment test terpisah + data dummy (disarankan sebelum uji beban)
- [x] Scope revisi Bagian 1/2 dipetakan ke fase

---

## Fase 1 — Pengamanan Kritis

### 1. CRUD transaksional (ganti snapshot)

File: `server/mysql-adapter.ts`

- `writeSnapshot()` hanya dipakai sekali saat database MySQL masih kosong.
- Persist rutin sekarang memakai `persistDiff()`:
  - bandingkan state terakhir yang sudah tersimpan (`lastPersisted`) dengan state baru;
  - `INSERT` hanya baris baru;
  - `UPDATE` hanya baris berubah;
  - `DELETE` hanya baris yang hilang;
  - semua dalam satu transaksi;
  - insert/update urut parent → child, delete urut child → parent agar FK aman.
- Kolom dibaca dari `information_schema` sehingga tidak perlu daftar kolom manual.
- `queuePersist()` tetap serial lewat `syncQueue`.

### 2. Lock stok roll/tinta

File: `server/mysql-adapter.ts`, `server/store.ts`, `server.ts`

- `runLocked()` membuka transaksi, menjalankan `SELECT id FROM <table> FOR UPDATE`, lalu mutasi state, tulis diff, commit.
- `store.critical()` membungkus operasi kritis dan mengembalikan state memori ke snapshot bila transaksi gagal.
- Titik kritis yang sudah memakai lock:
  - `POST /api/operator/items/:id/selesai` → roll, offcut, produk, tinta/supply
  - `POST /api/operator/items/:id/gagal-cetak` → roll
  - `POST /api/finishing/items/:id/konfirmasi` → supply/bahan pembantu
  - `POST /api/owner/purchase-orders/:id/terima` → PO, roll, supply, produk
- `runTransactional()` menahan response sampai commit; bila persist gagal, klien menerima HTTP 500 dan state memori dipulihkan.

### 3. Proteksi `/uploads`

File: `server.ts`, `server/uploads.ts`

- `GET /uploads/*` sekarang wajib `requireAuth()`.
- File Self-ACC diakses lewat rute ber-token:
  `GET /api/public/approval/:token/file/:filename`
- Rute token hanya mengizinkan file milik nota tersebut: preview item, revisi desain, lampiran briefing, dan bukti bayar nota itu.
- Nama file divalidasi anti path traversal.
- Respons API approval publik menulis ulang URL `/uploads/...` menjadi URL ber-token.

### 4. Validasi env & token

File: `server/security.ts`, `server/auth.ts`, `wa-bridge/server.mjs`, `.env.example`

- `NODE_ENV=production` menolak start bila:
  - `SESSION_SECRET` kosong / < 32 karakter / masih placeholder;
  - `WHATSAPP_WEBHOOK_TOKEN` kosong;
  - `WA_BRIDGE_TOKEN` kosong;
  - `ENABLE_DEMO_SWITCH` bukan `false`.
- Development hanya memberi peringatan.
- `auth.ts` tidak lagi memakai fallback secret statis; production wajib secret, development memakai secret acak sementara.
- Bridge WhatsApp menolak start bila token kosong.
- Default `ENABLE_DEMO_SWITCH` di server dan UI diubah menjadi nonaktif.

### 5. Hapus password default

File: `server/store.ts`, `src/components/LoginView.tsx`

- Seed baru memakai password acak per akun, ditulis ke `data/initial-credentials.txt` (mode 0600, masuk `.gitignore`).
- Saat startup, akun lama yang masih memakai `password123` otomatis direset ke password acak.
- Password baru ditulis ke `data/credentials-reset-<timestamp>.txt`.
- Halaman login tidak lagi mengisi email/password default dan tidak menampilkan `password123`.

### 6. Backup sebelum reset JSON

File: `server/store.ts`

- Jika `data/db.json` korup:
  - file asli disalin ke `data/db.json.corrupt-<timestamp>`;
  - baru setelah itu seed baru dibuat.
- `resetSeed()` otomatis membuat backup `data/backups/db-pre-reset-<timestamp>.json`.
- `.gitignore` diperluas untuk backup, file kredensial, dan file corrupt.

---

## Cara test

### Otomatis

```bash
npm test
npx tsc --noEmit
```

Hasil saat ini: 11 test lulus, TypeScript tanpa error.

### Manual — keamanan

1. Jalankan `npm run dev`.
2. Cek log startup:
   - ada peringatan token WA kosong (development);
   - ada laporan password default direset bila `db.json` lama.
3. Login memakai password dari `data/credentials-reset-*.txt`.
4. Buka `http://localhost:3000/uploads/apa-saja.png` tanpa login → harus `401`.
5. Buka link Self-ACC `/acc/<token>` → preview tetap tampil lewat URL `/api/public/approval/<token>/file/...`.
6. Coba ubah nama file pada URL token → harus `404`.

### Manual — produksi

```bash
set NODE_ENV=production
node server.js
```

Tanpa `SESSION_SECRET`/token WA yang valid, server harus menolak start dengan pesan jelas.

### Manual — MySQL

1. Set `DB_DRIVER=mysql` dan kredensial MySQL.
2. Jalankan server.
3. Buat 1 nota, selesaikan cetak 1 item.
4. Cek log MySQL: tidak boleh ada `DELETE FROM orders` / `DELETE FROM order_items` massal.
5. Cek tabel `material_rolls`, `supplies`, `material_logs`, `audit_logs` bertambah sesuai transaksi.
6. Matikan MySQL saat transaksi selesai cetak → endpoint harus `500`, stok memori tidak berubah.

---

## Catatan migrasi

1. **Password**: setelah login pertama, ganti semua password lewat menu staf, lalu hapus:
   - `data/initial-credentials.txt`
   - `data/credentials-reset-*.txt`
2. **Token WA**: isi `WHATSAPP_WEBHOOK_TOKEN` dan `WA_BRIDGE_TOKEN` dengan nilai acak yang sama. Tanpa ini bridge tidak mau start.
3. **SESSION_SECRET**: gunakan minimal 32 karakter acak. Contoh:
   `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`
4. **Uploads**: link lama `/uploads/...` tetap bekerja untuk user login. Untuk pelanggan, gunakan link Self-ACC baru; API approval sudah menulis ulang URL.
5. **MySQL**: tidak ada perubahan skema baru di Fase 1. CRUD diff memakai kolom yang sudah ada. Tetap backup DB sebelum deploy.
6. **JSON**: `data/db.json` akan berubah karena password default direset otomatis saat startup pertama setelah update.
7. **Build produksi**: jalankan `npm run build` ulang agar `server.js` memuat kode Fase 1. File `server.js` lama belum tentu sinkron.

---

## Sisa pekerjaan Fase 2 (belum diubah)

- `getActiveUser` cek `active === true`.
- Filter non-billing untuk Advertising di riwayat.
- Hapus `preset_url` dan URL mockup hardcoded.
- Token laporan Owner lewat header.
- Form Edit Instansi (limit kredit, NPWP, PKP, PPN, PPh 23).
- Validasi nota, finishing, gagal cetak, void nota.
- Validasi tanggal dan ID numerik.
- Perbaikan UI/UX Fase 3.
- Fitur lanjutan Fase 4.

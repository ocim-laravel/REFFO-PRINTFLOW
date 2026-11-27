# Keterangan Baris per Baris Fungsi Inti — Reffo PrintFlow

Tanggal: 27 November 2026.

## 1. Hasil verifikasi terbaru

| Pemeriksaan | Hasil |
|---|---|
| `npm test` | 30/30 lulus (5 file: fase1, fase2a, fase2b, fase3a, fase4-domain) |
| `npm run test:smoke` (server uji port 3100) | 21/21 alur lulus |
| `npm run lint` | 0 error TypeScript |
| `npm run build` | sukses (`dist/` + `server.js` diperbarui) |
| Server manual | `http://localhost:3000` aktif memakai kode terbaru (`npm run dev`) |

Data uji smoke memakai direktori terpisah:
`C:\Users\ASUS\AppData\Local\Temp\opencode\reffo-smoke-3100`.
Data operasional `data/db.json` dan `uploads/` di project tidak diubah oleh smoke test.

## 2. Progres pekerjaan

| Fase | Status | Catatan |
|---|---|---|
| Fase 0 — Audit & persiapan | Selesai | backup `data/backups/` |
| Fase 1 — Pengamanan kritis | Selesai | CRUD diff MySQL, lock stok, `/uploads` wajib auth, validasi env, password seed acak |
| Fase 2 — Stabilisasi logika & akses | Selesai | akses, pajak, WA/Self-ACC, TIFF massal, transaksi kritis, mesin tunggal |
| Fase 3 — UI/UX & administrasi | Selesai | supplier/PO, tab Batal/Piutang, ErrorBoundary, 401 logout, badge polling, QC finishing, grup cetak |
| Fase 4 — Fitur lanjutan | Selesai | scheduler harian, batch nesting, stock opname, preflight desain, finishing berantai, geo-tag SPK, kurir/resi, biaya desain, refactor server |

Dua catatan masih terbuka sesuai `RENCANA_IMPLEMENTASI.md`:
- laporan tinta harian Owner belum ada di `GET /api/owner/reports/materials` (baris 5468-5515);
- override konversi tinta lewat UI Owner belum ada (nilai per warna hanya tampil di `OperatorView.tsx:711`).

## 3. Peta alur yang diuji (`tests/smoke-flow.mjs`)

| # | Alur | Endpoint utama | Bukti di script |
|---|---|---|---|
| 1 | Tanpa login ditolak | `GET /api/bootstrap`, `GET /uploads/*` | status 401 |
| 2 | Login 6 peran + password salah | `POST /api/auth/login` | token per role, salah → 401 |
| 3 | Demo switch mati | `/api/auth/accounts`, `/api/auth/switch` | 403 |
| 4 | Admin auto-shift | `GET /api/shifts/current` | `status = buka` |
| 4 | Bootstrap master | `GET /api/bootstrap` | pajak, tinta, cattoff, mesin ada |
| 6 | Role guard | `/api/orders`, `/api/owner/*`, `/api/operator/queue` | 403 |
| 7 | Validasi nota | `POST /api/orders` | tanggal/item/SPK invalid → 422, tidak ada nota yatim |
| 8 | Buat nota | `POST /api/orders` | PPN 11% = 3300, total 33300, Self-ACC token ada |
| 9 | Sensor nominal Advertising | `GET /api/riwayat/:divisi` | semua nominal 0 |
| 10 | Desainer terima + preview | `/api/desainer/orders/:id/terima`, `/preview` | tanpa file 422, dengan file → `menunggu_acc` |
| 11 | WA outbox | `GET /api/owner/whatsapp-outbox` | `nota_dibuat`, `preview_siap_acc` |
| 12 | TIFF sebelum ACC | `/api/desainer/items/:id/tiff` | 422 |
| 13 | Self-ACC | `/api/public/approval/:token` | revisi, ACC, duplikat 409 |
| 14 | ACC admin | `/api/admin/design-reviews/:id/approve` | `acc_admin_id` + `acc_pelanggan_at` terpisah |
| 15 | TIFF + master | `/tiff`, `/tiff-massal`, `/master` | `.pdf` 422, `.cdr` 200, item → `antrean_cetak` |
| 16 | Cetak | `/operator/items/:id/mulai`, `/selesai` | cattoff, tinta 3,72 ml/m²/warna, WOS tanpa offcut |
| 17 | QC finishing | `/finishing/items/:id/qc`, `/konfirmasi` | cacat → `cetak_ulang`, lolos → foto → `siap_diambil` |
| 18 | Bayar + serah terima | `/pelunasan`, `/serah-terima` | belum lunas 403, lalu item `selesai` |
| 19 | Laporan & ekspor | `/api/owner/reports/*`, `/export` | tanpa token 401, dengan header → CSV |
| 20 | Pajak bisa diubah | `PUT /api/owner/settings/tax` | nota baru pakai PPN 10%, lalu dikembalikan + void |
| 21 | Purchasing | `/api/owner/suppliers`, `/purchase-orders/*` | draft → edit → kirim → terima → bayar |

## 4. `server/domain.ts` — keterangan per baris

### `round2` (baris 1-3)
- `1`: deklarasi fungsi pembulatan 2 desimal.
- `2`: tambah `Number.EPSILON` agar kasus seperti `1.005` tidak salah bulat, lalu bulatkan.
- `3`: tutup fungsi.

### `clampPercent` (baris 5-9)
- `5`: terima nilai apa pun, hasilkan persentase number.
- `6`: konversi ke number; `null`/`undefined` jadi 0.
- `7`: nilai bukan finito (NaN/Infinity) dikembalikan 0.
- `8`: bulatkan 2 desimal, lalu batasi rentang 0-100.
- `9`: tutup fungsi.

### `parsePositiveId` (baris 15-23)
- `15`: deklarasi; hasil `number` atau `null`.
- `16`: khusus input number, cek dulu tipe aslinya.
- `17`: number harus bulat dan > 0; selain itu `null`.
- `18`: tutup cabang number.
- `19`: input lain diubah ke string, trim spasi.
- `20`: hanya boleh digit `0-9`; menolak `12abc`, `-5`, `12.5`.
- `21`: ubah string digit ke number.
- `22`: wajib bulat, aman (`Number.isSafeInteger`), dan > 0.
- `23`: tutup fungsi.

### `parseTanggalInput` (baris 30-65)
- `30`: deklarasi fungsi validasi tanggal.
- `31`: parameter opsional; hasil `{valid, iso}`.
- `32`: tutup tipe hasil.
- `33`: `undefined`/`null` dianggap kosong dan valid.
- `34`: ubah input ke string dan trim.
- `35`: string kosong dianggap valid, `iso = null`.
- `36`: baris kosong.
- `37`: cocokkan pola ketat `YYYY-MM-DD`.
- `38`: jika pola tanggal ditemukan …
- `39`: ambil tahun.
- `40`: ambil bulan.
- `41`: ambil tanggal.
- `42`: bulan harus 1-12, tanggal 1-31.
- `43`: kalau tidak, kembalikan valid=false.
- `44`: tutup cabang.
- `45`: buat tanggal UTC dari komponen tersebut.
- `46`: mulai cek apakah tanggal benar-benar ada.
- `47`: tahun hasil harus sama dengan tahun input.
- `48`: bulan hasil harus sama.
- `49`: tanggal hasil harus sama (menolak 2026-02-30).
- `50`: tutup kondisi.
- `51`: kalau tidak sama, kembalikan valid=false.
- `52`: tutup cabang.
- `53`: tanggal sah dikembalikan sebagai ISO UTC.
- `54`: tutup cabang `dateOnlyMatch`.
- `55`: baris kosong.
- `56`: komentar: format ISO datetime harus punya awalan `YYYY-MM-DDT`.
- `57`: tolak format lain (`31-12-2026`, dll.).
- `58`: kembalikan valid=false.
- `59`: tutup cabang.
- `60`: parsing ISO oleh `Date`.
- `61`: cek hasil parsing bukan `Invalid Date`.
- `62`: kalau invalid, kembalikan valid=false.
- `63`: tutup cabang.
- `64`: datetime sah dikembalikan ISO.
- `65`: tutup fungsi.

### `buildDefaultTaxSettings` (baris 80-91)
- `80`: deklarasi pengaturan pajak awal.
- `81`: mulai objek.
- `82`: id tetap 1.
- `83`: PPN default 11%.
- `84`: PPh23 default 2%.
- `85`: mode harga default: belum termasuk PPN.
- `86`: diskon ikut mengurangi DPP.
- `87`: PPh23 tidak dipotong otomatis.
- `88`: belum pernah di-update.
- `89`: belum ada user peng-update.
- `90`: tutup objek.
- `91`: tutup fungsi.

### `computeEffectiveTaxRates` (baris 93-140)
- `93`: deklarasi; masukan payload, instansi, pengaturan global.
- `94`: override PPN dari payload nota.
- `95`: override PPh23 dari payload nota.
- `96`: data instansi opsional.
- `97`: `is_pkp`, `npwp`.
- `98`: tarif PPN instansi.
- `99`: tarif PPh23 instansi.
- `100`: tutup tipe instansi; boleh null.
- `101`: pengaturan global opsional.
- `102`: tutup parameter.
- `103`: hasil berupa persen PPN dan PPh23.
- `104`: global kosong → pakai default bawaan.
- `105`: simpan instansi ke variabel lokal.
- `106`: baris kosong.
- `107`: PPN awal 0.
- `108`: jika ada instansi …
- `109`: instansi punya tarif PPN > 0 → pakai tarif itu.
- `110`: simpan tarif instansi.
- `111`: kalau tidak, dan instansi PKP …
- `112`: pakai PPN default global.
- `113`: kalau field PPN tidak diisi …
- `114`: tetap pakai default global.
- `115`: tutup cabang instansi ada.
- `116`: kalau tidak ada instansi …
- `117`: pakai default global.
- `118`: tutup cabang.
- `119`: baris kosong.
- `120`: PPh23 awal 0.
- `121`: jika ada instansi …
- `122`: tarif PPh23 instansi > 0 → pakai.
- `123`: simpan tarif itu.
- `124`: kalau tidak, potong otomatis aktif dan NPWP ada …
- `125`: pakai PPh23 default global.
- `126`: tutup cabang.
- `127`: tanpa instansi, potong otomatis aktif …
- `128`: pakai PPh23 default global.
- `129`: tutup cabang.
- `130`: baris kosong.
- `131`: cek payload PPN diisi (bukan null/kosong).
- `132`: definisi lengkap pengecekan payload PPN.
- `133`: cek payload PPh23 diisi.
- `134`: definisi lengkap pengecekan payload PPh23.
- `135`: baris kosong.
- `136`: kembalikan objek hasil.
- `137`: payload PPN menang; kalau tidak, default; lalu clamp 0-100.
- `138`: payload PPh23 menang; kalau tidak, default; lalu clamp.
- `139`: tutup objek.
- `140`: tutup fungsi.

### `hitungPajakNota` (baris 142-177)
- `142`: deklarasi hitung pajak nota.
- `143`: total sebelum diskon.
- `144`: diskon nota (persen).
- `145`: persen PPN.
- `146`: persen PPh23.
- `147`: mode harga.
- `148`: apakah diskon ikut mengurangi DPP (opsional).
- `149`: tutup parameter.
- `150`: hasil: diskon, DPP, PPN, PPh23, total.
- `151`: `dpp`.
- `152`: `ppnNominal`.
- `153`: `pph23Nominal`.
- `154`: `totalTagihan`.
- `155`: tutup tipe hasil.
- `156`: subtotal dibatasi minimal 0 dan dibulatkan.
- `157`: diskon persen di-clamp.
- `158`: nominal diskon = subtotal × persen.
- `159`: persen PPN di-clamp.
- `160`: persen PPh23 di-clamp.
- `161`: dasar setelah diskon, minimal 0.
- `162`: dasar pajak; bila `ppn_termasuk_diskon === false`, pakai subtotal sebelum diskon.
- `163`: baris kosong.
- `164`: jika harga sudah termasuk PPN dan PPN > 0 …
- `165`: DPP diekstrak dari harga inclusive: `dasar / (1 + ppn)`.
- `166`: PPN = selisih dasar dengan DPP (tidak dihitung dua kali).
- `167`: PPh23 dihitung dari DPP.
- `168`: tagihan = dasar setelah diskon dikurangi PPh23.
- `169`: kembalikan hasil mode inclusive.
- `170`: tutup cabang.
- `171`: baris kosong.
- `172`: mode eksklusif: DPP = dasar pajak.
- `173`: PPN = DPP × persen.
- `174`: PPh23 = DPP × persen.
- `175`: total = dasar setelah diskon + PPN − PPh23, minimal 0.
- `176`: kembalikan hasil mode eksklusif.
- `177`: tutup fungsi.

### `isEditableMasterFilename` (baris 181-184)
- `181`: deklarasi; hanya `.ai/.psd/.cdr` yang boleh.
- `182`: lowercase + trim nama file.
- `183`: cek akhiran terhadap daftar ekstensi editable.
- `184`: tutup fungsi.

### `isTiffFilename` (baris 186-189)
- `186`: deklarasi pengecek file cetak.
- `187`: lowercase + trim.
- `188`: akhiran `.tif` atau `.tiff`.
- `189`: tutup fungsi.

### `resolveBulkTiffMapping` (baris 196-292)
- `196`: deklarasi pemetaan TIFF massal.
- `197`: daftar nama file.
- `198`: item nota; wajib punya `acc_admin_id`.
- `199`: peta eksplisit dari frontend opsional.
- `200`: tutup parameter.
- `201`: hasil: `ok`, `mappings`, `unmapped`, `errors`.
- `202`: pasangan filename → item.
- `203`: file tanpa pasangan.
- `204`: pesan error.
- `205`: tutup tipe hasil.
- `206`: ambil parameter.
- `207`: indeks item berdasarkan id.
- `208`: daftar pasangan yang valid.
- `209`: daftar file tanpa pasangan.
- `210`: daftar error.
- `211`: cegah satu item dipetakan dua file.
- `212`: baris kosong.
- `213`: jika frontend mengirim peta eksplisit …
- `214`: indeks peta filename → item id.
- `215`: loop setiap entri peta.
- `216`: nama file dibersihkan.
- `217`: item id divalidasi `parsePositiveId`.
- `218`: entri valid disimpan.
- `219`: tutup loop.
- `220`: baris kosong.
- `221`: untuk setiap file yang diunggah …
- `222`: wajib `.tif/.tiff`.
- `223`: kalau bukan, catat error.
- `224`: lanjut ke file berikutnya.
- `225`: tutup cabang ekstensi.
- `226`: ambil item id dari peta.
- `227`: kalau tidak ada …
- `228`: masukkan ke `unmapped`.
- `229`: lanjut.
- `230`: tutup cabang.
- `231`: cari item di nota.
- `232`: kalau item tidak ada …
- `233`: error: item bukan milik nota ini.
- `234`: lanjut.
- `235`: tutup cabang.
- `236`: item belum di-ACC admin …
- `237`: error: item belum di-ACC.
- `238`: lanjut.
- `239`: tutup cabang.
- `240`: item sudah dipakai file lain …
- `241`: error: duplikat item.
- `242`: lanjut.
- `243`: tutup cabang.
- `244`: tandai item terpakai.
- `245`: simpan pasangan.
- `246`: tutup loop eksplisit.
- `247`: kalau tidak ada peta eksplisit …
- `248`: loop tiap filename.
- `249`: wajib `.tif/.tiff`.
- `250`: kalau bukan, error.
- `251`: lanjut.
- `252`: tutup cabang.
- `253`: id hasil tebakan awal `null`.
- `254`: tebak pola `item-<id>` / `item_<id>`.
- `255`: jika pola cocok …
- `256`: ubah id ke number.
- `257`: hanya terima jika id ada di nota.
- `258`: tutup cabang pola.
- `259`: belum cocok …
- `260`: coba pola indeks urut di awal nama (`1_...`, `2-...`).
- `261`: jika cocok …
- `262`: indeks array = angka depan − 1.
- `263`: indeks harus masih dalam rentang item.
- `264`: ambil id item pada indeks itu.
- `265`: tutup cabang indeks.
- `266`: tutup cabang fallback.
- `267`: masih belum cocok …
- `268`: masukkan ke `unmapped`.
- `269`: lanjut.
- `270`: tutup cabang.
- `271`: ambil item hasil tebakan.
- `272`: item belum di-ACC → masuk cabang error.
- `273`: error: item belum di-ACC Admin.
- `274`: lanjut ke file berikutnya.
- `275`: tutup cabang ACC.
- `276`: item sudah dipetakan file lain → cabang error.
- `277`: error: item cocok ke lebih dari satu file.
- `278`: lanjut.
- `279`: tutup cabang duplikat.
- `280`: tandai item terpakai.
- `281`: simpan pasangan filename → item.
- `282`: tutup loop fallback.
- `283`: tutup cabang `else`.
- `284`: baris kosong.
- `285`: baris kosong.
- `286`: mulai `return`.
- `287`: `ok` hanya jika tidak ada yang belum dipetakan, tidak ada error, dan semua file terpasang.
- `288`: sertakan `mappings`.
- `289`: sertakan `unmapped`.
- `290`: sertakan `errors`.
- `291`: tutup objek.
- `292`: tutup fungsi.

### Konstanta dan `hitungTintaMlPerM2` (baris 294-310)
- `294`: kapasitas galon 5000 ml.
- `295`: 1 galon untuk 6 roll.
- `296`: luas 1 roll 3,2 × 70 = 224 m².
- `302`: deklarasi konversi ml/m².
- `303`: default kapasitas galon.
- `304`: default jumlah roll.
- `305`: default luas per roll.
- `306`: tutup parameter.
- `307`: total luas = roll × luas per roll.
- `308`: kapasitas atau luas tidak valid → 0.
- `309`: hasil = kapasitas / total luas, dibulatkan → 3,72.
- `310`: tutup fungsi.

### `hitungPemakaianTintaPerWarna` (baris 312-327)
- `312`: deklarasi hitung pemakaian per warna.
- `313`: luas cetak.
- `314`: daftar warna + konsumsi ml/m².
- `315`: tutup parameter.
- `316`: rincian per warna.
- `317`: total ml.
- `318`: tutup tipe hasil.
- `319`: luas minimal 0, dibulatkan.
- `320`: petakan setiap warna …
- `321`: id warna.
- `322`: nama warna.
- `323`: ml = luas × konsumsi warna, minimal 0.
- `324`: tutup objek rincian.
- `325`: total = jumlah seluruh rincian.
- `326`: kembalikan rincian + total.
- `327`: tutup fungsi.

### `hitungPemakaianBahanPrn` (baris 329-355)
- `329`: deklarasi hitung bahan dari ukuran file `.prn`.
- `330`: panjang file.
- `331`: lebar file.
- `332`: lebar kontainer (roll/cattoff/offcut).
- `333`: lebar offcut input operator (opsional).
- `334`: panjang offcut input operator (opsional).
- `335`: tutup parameter.
- `336`: luas file.
- `337`: luas kontainer.
- `338`: luas offcut manual.
- `339`: luas sisa potong → WOS.
- `340`: apakah offcut manual dibuat.
- `341`: tutup tipe hasil.
- `342`: panjang minimal 0, dibulatkan.
- `343`: lebar minimal 0, dibulatkan.
- `344`: lebar kontainer minimal sebesar lebar file.
- `345`: luas file = panjang × lebar.
- `346`: luas kontainer = lebar kontainer × panjang.
- `347`: baris kosong.
- `348`: lebar offcut input (`offL`).
- `349`: panjang offcut input (`offP`).
- `350`: offcut dibuat hanya bila lebar dan panjang > 0.
- `351`: luas offcut manual.
- `352`: WOS = sisa kontainer − file − offcut, minimal 0.
- `353`: baris kosong.
- `354`: kembalikan seluruh angka.
- `355`: tutup fungsi.

### `statusSetelahCetak` (baris 357-359)
- `357`: deklarasi; hasil `selesai` atau `antrean_cetak`.
- `358`: selesai bila total qty tercetak + toleransi 0,001 ≥ qty pesanan.
- `359`: tutup fungsi.

### `resolveQcStatus` (baris 361-365)
- `361`: deklarasi terjemahan hasil QC.
- `362`: `lolos` → `proses_finishing`.
- `363`: `cacat` → `cetak_ulang`.
- `364`: nilai lain → `null` (ditolak endpoint).
- `365`: tutup fungsi.

### `isSameOperationalDay` (baris 367-377)
- `367`: deklarasi; cek tanggal lokal yang sama.
- `368`: input di-string dan di-trim.
- `369`: kosong dianggap sama (tidak ada filter tanggal).
- `370`: validasi format via `parseTanggalInput`.
- `371`: format invalid → false.
- `372`: ambil 10 karakter pertama `YYYY-MM-DD`.
- `373`: tahun acuan lokal.
- `374`: bulan acuan lokal, 2 digit.
- `375`: tanggal acuan lokal, 2 digit.
- `376`: bandingkan dengan tanggal target.
- `377`: tutup fungsi.

## 5. `server/security.ts` — keterangan per baris

### `isProduction` (29-31)
- `29`: deklarasi pengecek mode production.
- `30`: `NODE_ENV` di-lowercase; sama dengan `production` → true.
- `31`: tutup fungsi.

### `filled` (33-35)
- `33`: deklarasi normalisasi nilai env.
- `34`: null/undefined jadi string kosong, lalu trim.
- `35`: tutup fungsi.

### `validateSecurityEnv` (37-83)
- `37`: deklarasi validasi; default `process.env`.
- `38`: kumpulan error.
- `39`: kumpulan peringatan.
- `40`: flag production.
- `41`: baris kosong.
- `42`: baca `SESSION_SECRET`.
- `43`: kosong …
- `44`: production → error, development → warning.
- `45`: pesan secret belum diisi.
- `46`: tutup push.
- `47`: terlalu pendek …
- `48`: production → error, development → warning.
- `49`: pesan minimal 32 karakter.
- `50`: tutup push.
- `51`: masih memakai nilai contoh …
- `52`: production → error, development → warning.
- `53`: pesan ganti secret.
- `54`: tutup push.
- `55`: tutup cabang secret.
- `56`: baris kosong.
- `57`: baca token webhook WA.
- `58`: baca token bridge WA.
- `59`: webhook kosong …
- `60`: production → error, development → warning.
- `61`: pesan bridge menolak start.
- `62`: tutup push.
- `63`: tutup cabang.
- `64`: token bridge kosong …
- `65`: production → error, development → warning.
- `66`: pesan samakan token.
- `67`: tutup push.
- `68`: tutup cabang.
- `69`: dua token ada tapi beda …
- `70`: selalu berupa peringatan.
- `71`: pesan pastikan keduanya sama.
- `72`: tutup push.
- `73`: tutup cabang.
- `74`: baris kosong.
- `75`: baca `ENABLE_DEMO_SWITCH`, default `false`.
- `76`: production dan nilainya bukan `false` …
- `77`: tambahkan error.
- `78`: pesan demo switch harus false.
- `79`: tutup push.
- `80`: tutup cabang.
- `81`: baris kosong.
- `82`: kembalikan `{errors, warnings}`.
- `83`: tutup fungsi.

### `assertSecurityEnv` (85-96)
- `85`: deklarasi; melempar error bila produksi tidak aman.
- `86`: jalankan validasi.
- `87`: loop tiap peringatan.
- `88`: cetak peringatan ke console.
- `89`: tutup loop.
- `90`: jika ada error …
- `91`: lempar Error.
- `92`: daftar error, satu per baris.
- `93`: instruksi perbaiki `.env` dan restart.
- `94`: tutup `throw`.
- `95`: tutup cabang.
- `96`: tutup fungsi.

Konstanta terkait (bukan fungsi): `MIN_SESSION_SECRET_LENGTH = 32` (11), `PLACEHOLDER_SECRETS` (13-22), antarmuka `SecurityEnvResult` (24-27).

## 6. `server/uploads.ts` — keterangan per baris

### `safeUploadFilename` (4-9)
- `4`: deklarasi; nama aman atau `null`.
- `5`: `path.basename` membuang semua direktori (anti path traversal).
- `6`: nama kosong, `.` atau `..` ditolak.
- `7`: hanya huruf, angka, titik, underscore, hyphen yang boleh.
- `8`: kembalikan nama yang sudah aman.
- `9`: tutup fungsi.

### `toPublicPreviewUrl` (12-22)
- `12`: deklarasi; ubah path internal ke URL ber-token.
- `13`: path tersimpan (boleh null).
- `14`: token approval pelanggan.
- `15`: tutup parameter.
- `16`: tidak ada file → `null`.
- `17`: bukan `/uploads/...` (mis. URL CDN) → kembalikan apa adanya.
- `18`: ambil nama file, validasi anti traversal.
- `19`: jika nama valid …
- `20`: URL = `/api/public/approval/<token>/file/<nama>`.
- `21`: kalau nama tidak valid → `null`.
- `22`: tutup fungsi.

## 7. `server/auth.ts` — keterangan per baris

### `getSessionSecret` (12-30)
- `12`: deklarasi; secret dibaca lazily setelah dotenv.
- `13`: baca `SESSION_SECRET` dari env.
- `14`: bila ada, langsung pakai.
- `15`: baris kosong.
- `16`: produksi tanpa secret …
- `17`: lempar error (tidak ada fallback di produksi).
- `18`: tutup cabang.
- `19`: baris kosong.
- `20`: development: buat secret acak sekali.
- `21`: 48 byte acak → hex.
- `22`: tutup cabang.
- `23`: peringatan hanya sekali.
- `24`: tandai sudah diperingatkan.
- `25`: mulai console.warn.
- `26`: pesan token hangus saat restart.
- `27`: tutup warn.
- `28`: tutup cabang.
- `29`: kembalikan secret.
- `30`: tutup fungsi.

### `hashPassword` (32-37)
- `32`: deklarasi hash scrypt.
- `33`: buat salt acak 16 byte hex.
- `34`: scrypt password + salt, 64 byte, hex.
- `35`: format `scrypt:<salt>:<hash>`.
- `36`: kembalikan format tersebut.
- `37`: tutup fungsi.

### `verifyPassword` (38-49)
- `38`: deklarasi verifikasi.
- `39`: hash bukan format scrypt → cabang kompatibilitas lama.
- `40`: bandingkan plain.
- `41`: tutup cabang.
- `42`: pecah format menjadi 3 bagian.
- `43`: bukan 3 bagian → false.
- `44`: ambil salt dan hex hash.
- `45`: scrypt ulang dengan salt tersimpan.
- `46`: decode hash tersimpan ke buffer.
- `47`: panjang beda → false.
- `48`: bandingkan dalam waktu konstan (`timingSafeEqual`).
- `49`: tutup fungsi.

### `signSessionToken` (57-66)
- `57`: deklarasi pembuatan token.
- `58`: mulai payload.
- `59`: uid user.
- `60`: role user.
- `61`: expiry 7 hari.
- `62`: tutup payload.
- `63`: encode JSON ke base64url.
- `64`: HMAC-SHA256 atas encoded dengan secret.
- `65`: token = `encoded.sig`.
- `66`: tutup fungsi.

### `verifySessionToken` (68-87)
- `68`: deklarasi verifikasi token.
- `69`: token kosong/tanpa titik → null.
- `70`: pisahkan encoded dan signature.
- `71`: salah satu kosong → null.
- `72`: hitung ulang HMAC.
- `73`: signature sebagai buffer.
- `74`: expected signature sebagai buffer.
- `75`: panjang beda atau isi beda → null (`timingSafeEqual`).
- `76`: return null.
- `77`: tutup cabang.
- `78`: mulai `try`.
- `79`: parse JSON base64url.
- `80`: uid/exp wajib ada dan exp belum lewat.
- `81`: return null.
- `82`: tutup cabang.
- `83`: kembalikan payload.
- `84`: tangkap error decode.
- `85`: return null.
- `86`: tutup `catch`.
- `87`: tutup fungsi.

### `parseCookie` (89-101)
- `89`: deklarasi ambil cookie by name.
- `90`: tanpa header → null.
- `91`: pecah berdasarkan `;`.
- `92`: loop tiap pasangan.
- `93`: cari tanda `=`.
- `94`: tidak ada `=` → lewati.
- `95`: nama cookie trim.
- `96`: jika nama sesuai …
- `97`: decode nilai cookie.
- `98`: tutup cabang.
- `99`: tutup loop.
- `100`: tidak ketemu → null.
- `101`: tutup fungsi.

## 8. `server/store.ts` — fungsi pembantu (baris 123-294)

### `round2` (123-125)
- `123`: deklarasi pembulatan 2 desimal (versi store).
- `124`: `Math.round((val + EPSILON) * 100) / 100`.
- `125`: tutup fungsi.

### `buildDefaultInsentifRates` (139-146)
- `139`: deklarasi tarif insentif awal.
- `140`: petakan daftar default.
- `141`: salin rate.
- `142`: id berurutan mulai 1.
- `143`: belum di-update.
- `144`: belum ada peng-update.
- `145`: tutup objek & map.
- `146`: tutup fungsi.

### `buildDefaultTintaWarna` (148-157)
- `148`: deklarasi stok tinta awal.
- `149`: timestamp sekarang.
- `150`: konsumsi dihitung dari konversi 5000 ml / 6 roll / 224 m² → 3,72.
- `151`: mulai array 4 warna.
- `152`: Cyan: stok 5000 ml, min 1000, kapasitas 5000, 6 roll, 224 m², aktif.
- `153`: Magenta: nilai sama.
- `154`: Yellow: nilai sama.
- `155`: Black: nilai sama.
- `156`: tutup array.
- `157`: tutup fungsi.

### `buildDefaultStokCattoff` (159-174)
- `159`: deklarasi stok cattoff awal.
- `160`: timestamp.
- `161`: array satu cattoff.
- `162`: mulai objek.
- `163`: id 1.
- `164`: kode `CT-MMT280-01`.
- `165`: jenis MMT 280.
- `166`: lebar 3,2 m.
- `167`: panjang awal 15 m.
- `168`: sisa 15 m.
- `169`: status aktif.
- `170`: created_at.
- `171`: updated_at.
- `172`: tutup objek.
- `173`: tutup array.
- `174`: tutup fungsi.

### `buildDefaultWhatsappGatewayConfig` (177-190)
- `177`: deklarasi konfigurasi gateway WA awal.
- `178`: baca `WHATSAPP_WEBHOOK_URL` dari env.
- `179`: mulai objek.
- `180`: id 1.
- `181`: URL tanpa trailing slash.
- `182`: token webhook dari env.
- `183`: app URL dari env, fallback `localhost:<PORT>`.
- `184`: trim.
- `185`: buang trailing slash.
- `186`: aktif hanya bila URL ada.
- `187`: belum di-update.
- `188`: belum ada peng-update.
- `189`: tutup objek.
- `190`: tutup fungsi.

### `priceForCategory` (192-203)
- `192`: deklarasi pilih harga berdasarkan kategori pelanggan.
- `193`: mulai switch.
- `194`: kategori reseller …
- `195`: pakai `harga_reseller`.
- `196`: kategori prioritas …
- `197`: pakai `harga_prioritas`.
- `198`: kategori pegawai …
- `199`: pakai `harga_pegawai`.
- `200`: selain itu …
- `201`: pakai `harga_umum`.
- `202`: tutup switch.
- `203`: tutup fungsi.

### `computeUkuranKotor` (205-222)
- `205`: deklarasi ukuran kotor sebelum pemotongan.
- `206`: lebar bersih.
- `207`: tinggi bersih.
- `208`: qty.
- `209`: finishing opsional (tambahan cm).
- `210`: hasil `{lebar, tinggi, luas}`.
- `211`: ekstra kiri dari finishing (cm), default 0.
- `212`: ekstra kanan.
- `213`: ekstra atas.
- `214`: ekstra bawah.
- `215`: lebar kotor = lebar + (kiri + kanan)/100, dibulatkan.
- `216`: tinggi kotor = tinggi + (atas + bawah)/100, dibulatkan.
- `217`: mulai objek hasil.
- `218`: lebar.
- `219`: tinggi.
- `220`: luas = lebar × tinggi × qty.
- `221`: tutup objek.
- `222`: tutup fungsi.

### `isoOffsetDays` (224-229)
- `224`: deklarasi tanggal ISO dengan offset hari, jam default 09:15.
- `225`: salin tanggal sekarang.
- `226`: tambah offset hari.
- `227`: set jam 09:15:00.000.
- `228`: kembalikan ISO.
- `229`: tutup fungsi.

### `dateOffsetDays` (231-235)
- `231`: deklarasi tanggal `YYYY-MM-DD` dengan offset.
- `232`: salin tanggal sekarang.
- `233`: tambah offset.
- `234`: potong 10 karakter pertama.
- `235`: tutup fungsi.

### `notaDateStr` (237-244)
- `237`: deklarasi penanda tanggal nomor nota.
- `238`: salin tanggal sekarang.
- `239`: tambah offset.
- `240`: ambil tahun.
- `241`: bulan 2 digit.
- `242`: tanggal 2 digit.
- `243`: gabungkan `YYYYMMDD`.
- `244`: tutup fungsi.

### `generateSeedPassword` (246-248)
- `246`: deklarasi password acak seed.
- `247`: 12 byte acak → base64url.
- `248`: tutup fungsi.

### `writeSeedCredentials` (257-269)
- `257`: deklarasi tulis kredensial awal.
- `258`: sekali saja; kalau sudah atau tidak ada baris, return.
- `259`: tandai sudah ditulis.
- `260`: path file `data/initial-credentials.txt`.
- `261`: mulai array baris.
- `262`: header peringatan.
- `263`: timestamp pembuatan.
- `264`: baris `role<TAB>email<TAB>password`.
- `265`: baris kosong di akhir.
- `266`: gabungkan dengan newline.
- `267`: tulis UTF-8 dengan mode 0600.
- `268`: peringatan ke console.
- `269`: tutup fungsi.

### `writePasswordResetReport` (271-283)
- `271`: deklarasi laporan reset password default.
- `272`: tidak ada akun → return.
- `273`: timestamp aman untuk nama file.
- `274`: path `data/credentials-reset-<stamp>.txt`.
- `275`: mulai array baris.
- `276`: header penjelasan.
- `277`: peringatan hapus setelah ganti password.
- `278`: baris `email<TAB>password`.
- `279`: baris kosong.
- `280`: gabungkan newline.
- `281`: tulis mode 0600.
- `282`: peringatan jumlah akun.
- `283`: tutup fungsi.

### `backupDatabaseFile` (285-294)
- `285`: deklarasi backup `db.json`.
- `286`: file tidak ada → null.
- `287`: timestamp untuk nama file.
- `288`: direktori `data/backups`.
- `289`: buat direktori bila belum ada.
- `290`: nama file `db-<reason>-<stamp>.json`.
- `291`: salin file.
- `292`: log lokasi backup.
- `293`: kembalikan path.
- `294`: tutup fungsi.

`createInitialSeed` (296+) adalah pembangkit data awal (seed), bukan logika bisnis; tidak di-annotasi per baris di dokumen ini.

## 9. Fungsi pembantu `server.ts` dipakai alur

### `demoSwitchEnabled` (86-88)
- `86`: deklarasi.
- `87`: `ENABLE_DEMO_SWITCH` default `false`, hanya `true` persis yang aktif.
- `88`: tutup.

### `cleanupUploadedFiles` (160-169)
- `160`: deklarasi hapus file sementara saat validasi gagal.
- `161`: loop tiap file.
- `162`: tanpa path → lewati.
- `163`: coba hapus.
- `164`: `existsSync` + `unlinkSync`.
- `165`: tutup `if exists`.
- `166`: `catch`: gagal diabaikan.
- `167`: tutup catch.
- `168`: tutup loop.
- `169`: tutup fungsi.

### `broadcastEvent` (175-189)
- `175`: deklarasi siaran SSE.
- `176`: tanpa client → return cepat.
- `177`: mulai payload.
- `178`: tipe event.
- `179`: timestamp.
- `180`: detail tambahan.
- `181`: tutup payload.
- `182`: loop client SSE.
- `183`: kirim `event: domain_update`.
- `184`: format data SSE.
- `185`: tutup try.
- `186`: client error → hapus dari set.
- `187`: tutup catch.
- `188`: tutup loop.
- `189`: tutup fungsi.

### `sanitizeUser` (191-193)
- `191`: deklarasi; user tanpa hash password.
- `192`: pilih field aman; `active` default true.
- `193`: tutup fungsi.

### `extractToken` (195-203)
- `195`: deklarasi ambil token dari header/cookie.
- `196`: baca header authorization.
- `197`: harus diawali `Bearer `.
- `198`: potong 7 karakter pertama.
- `199`: bearer kosong → abaikan.
- `200`: kembalikan bearer.
- `201`: tutup cabang.
- `202`: fallback cookie `reffo_session`.
- `203`: tutup fungsi.

### `getActiveUser` (205-212)
- `205`: deklarasi user aktif dari token.
- `206`: ambil token.
- `207`: verifikasi HMAC + expiry.
- `208`: payload invalid → null.
- `209`: cari user di state berdasarkan uid.
- `210`: tidak ada / `active === false` → null (token lama langsung hangus).
- `211`: kembalikan user.
- `212`: tutup fungsi.

### `setSessionCookie` (214-219)
- `214`: deklarasi set cookie.
- `215`: mulai `res.setHeader`.
- `216`: nama cookie, token di-encode, Path=/, HttpOnly, SameSite=Lax.
- `217`: Max-Age 7 hari.
- `218`: tutup setHeader.
- `219`: tutup fungsi.

### `clearSessionCookie` (221-223)
- `221`: deklarasi hapus cookie.
- `222`: cookie kosong dengan Max-Age=0.
- `223`: tutup fungsi.

### `requireAuth` (225-239)
- `225`: deklarasi middleware, roles opsional.
- `226`: kembalikan middleware.
- `227`: ambil user aktif.
- `228`: tidak ada user …
- `229`: 401 + pesan sesi habis.
- `230`: return.
- `231`: tutup cabang.
- `232`: roles dibatasi dan role tidak termasuk …
- `233`: 403 + nama role.
- `234`: return.
- `235`: tutup cabang.
- `236`: simpan user di `req.currentUser`.
- `237`: lanjut ke handler.
- `238`: tutup middleware.
- `239`: tutup fungsi.

### `getCurrentUser` (241-243)
- `241`: deklarasi.
- `242`: baca `req.currentUser` yang dipasang `requireAuth`.
- `243`: tutup fungsi.

### `clientIp` (245-249)
- `245`: deklarasi IP klien.
- `246`: baca header `x-forwarded-for`.
- `247`: ada → ambil elemen pertama.
- `248`: tidak ada → `req.socket.remoteAddress`.
- `249`: tutup fungsi.

### `runTransactional` (255-290)
- `255`: deklarasi async pembungkus transaksi.
- `256`: response Express.
- `257`: pekerjaan yang mengubah state.
- `258`: pesan error jika gagal.
- `259`: tutup parameter, return void.
- `260`: penampung status/body respons sementara.
- `261`: simpan method `res.status` asli.
- `262`: simpan method `res.json` asli.
- `263`: baris kosong.
- `264`: ganti `res.status` …
- `265`: catat kode status.
- `266`: kembalikan `res` agar chain tetap jalan.
- `267`: tutup penggantian.
- `268`: ganti `res.json` …
- `269`: catat body (status default 200).
- `270`: kembalikan `res`.
- `271`: tutup penggantian.
- `272`: baris kosong.
- `273`: mulai try.
- `274`: jalankan pekerjaan; response ditahan sampai commit.
- `275`: tangkap error.
- `276`: log error transaksi.
- `277`: pulihkan `res.status`.
- `278`: pulihkan `res.json`.
- `279`: kalau header belum terkirim …
- `280`: kirim 500 + pesan error.
- `281`: return.
- `282`: tutup catch.
- `283`: baris kosong.
- `284`: pulihkan `res.status` setelah sukses.
- `285`: pulihkan `res.json`.
- `286`: jika handler sempat memanggil status/json …
- `287`: ada respons yang ditahan → cabang kirim ulang.
- `288`: kirim ulang status dan body asli.
- `289`: tutup cabang.
- `290`: tutup fungsi.

### `mesinUtamaCetak` (2929-2936)
- `2929`: deklarasi mesin tunggal otomatis.
- `2930`: ambil mesin aktif pertama.
- `2931`: ada → langsung pakai.
- `2932`: tidak ada → cek `mesin_default_id` produk.
- `2933`: cari mesin berdasarkan id default; fallback null.
- `2934`: tutup cabang.
- `2935`: tidak ada mesin → null.
- `2936`: tutup fungsi.

### `catatTintaPerWarna` (2938-2988)
- `2938`: deklarasi pencatatan pemakaian tinta per warna.
- `2939`: parameter `db`.
- `2940`: mulai objek parameter.
- `2941`: daftar id warna.
- `2942`: luas cetak.
- `2943`: id order item.
- `2944`: id grup (atau null).
- `2945`: timestamp.
- `2946`: tutup parameter.
- `2947`: tipe hasil: total, rincian, peringatan.
- `2948`: hilangkan duplikat id; hanya integer positif.
- `2949`: tidak ada id → cabang hasil kosong.
- `2950`: kembalikan `{totalMl:0, rincian:[], peringatan:null}`.
- `2951`: tutup cabang.
- `2952`: mulai daftar warna aktif.
- `2953`: cari tiap id di `db.tinta_warna`.
- `2954`: buang yang tidak ditemukan/nonaktif.
- `2955`: mulai mapping ke konsumsi.
- `2956`: id warna.
- `2957`: nama warna.
- `2958`: konsumsi per m²; fallback 3,72.
- `2959`: tutup mapping.
- `2960`: hitung pemakaian via `domain.ts`.
- `2961`: peringatan awal null.
- `2962`: rincian hasil awal kosong.
- `2963`: loop tiap rincian hitungan.
- `2964`: cari data warna di db.
- `2965`: tidak ada → lewati.
- `2966`: pemakaian dibatasi stok yang ada.
- `2967`: kurangi stok tinta.
- `2968`: update timestamp tinta.
- `2969`: stok lebih kecil dari kebutuhan → peringatan.
- `2970`: isi pesan peringatan.
- `2971`: tutup cabang.
- `2972`: mulai entri `pemakaian_tinta`.
- `2973`: id baru.
- `2974`: order item id.
- `2975`: grup id.
- `2976`: tinta warna id.
- `2977`: nama warna.
- `2978`: jumlah ml terpakai.
- `2979`: luas cetak.
- `2980`: timestamp.
- `2981`: tutup entri & push ke db.
- `2982`: tambahkan ke rincian hasil.
- `2983`: tutup loop.
- `2984`: sebagian warna tidak aktif → peringatan.
- `2985`: isi peringatan bila belum ada.
- `2986`: tutup cabang.
- `2987`: kembalikan total + rincian + peringatan.
- `2988`: tutup fungsi.

### `rincianPoItem` (4813-4849) dan `poWithSupplier` (4851-4858)
- `4813`: deklarasi validasi baris PO.
- `4814`: ambil state.
- `4815`: jenis barang.
- `4816`: id referensi.
- `4817`: qty.
- `4818`: harga satuan.
- `4819`: jenis harus roll/supply/produk.
- `4820`: kalau tidak → error.
- `4821`: tutup cabang.
- `4822`: referensi > 0, qty > 0, harga ≥ 0.
- `4823`: kalau tidak → error.
- `4824`: tutup cabang.
- `4825`: timestamp.
- `4826`: objek dasar item PO.
- `4827`: id diisi nanti.
- `4828`: po id.
- `4829`: jenis.
- `4830`: referensi id.
- `4831`: qty.
- `4832`: harga satuan.
- `4833`: subtotal.
- `4834`: created_at.
- `4835`: tutup objek dasar.
- `4836`: jenis roll …
- `4837`: cari roll.
- `4838`: tidak ada → error.
- `4839`: kembalikan item roll lengkap.
- `4840`: tutup cabang.
- `4841`: jenis supply …
- `4842`: cari supply.
- `4843`: tidak ada → error.
- `4844`: kembalikan item supply.
- `4845`: tutup cabang.
- `4846`: selain itu produk …
- `4847`: cari produk.
- `4848`: tidak ada → error; jika ada kembalikan item produk.
- `4849`: tutup fungsi.
- `4851`: deklarasi `poWithSupplier`.
- `4852`: ambil state.
- `4853`: mulai objek hasil.
- `4854`: salin PO.
- `4855`: nama supplier.
- `4856`: sisa hutang = total − sudah dibayar.
- `4857`: tutup objek.
- `4858`: tutup fungsi.

## 10. Cara menjalankan ulang

```bash
npm test            # 30 unit test
npm run lint        # tsc --noEmit
npm run build       # vite + esbuild server.ts
npm run dev         # server manual di http://localhost:3000
npm run test:smoke  # butuh server uji terpisah + SMOKE_CREDENTIALS
```

Contoh server uji terpisah (tidak menyentuh `data/db.json` project) menjalankan `server.ts` dengan working directory temp yang berisi `.env`, `data/`, dan `uploads/`, lalu:

```powershell
$env:SMOKE_BASE_URL='http://127.0.0.1:3100'
$env:SMOKE_CREDENTIALS='C:\Users\ASUS\AppData\Local\Temp\opencode\reffo-smoke-3100\data\initial-credentials.txt'
npm run test:smoke
```

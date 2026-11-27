# Jadwal Revisi & Rebuild Sistem Reffo Advertising

Mulai: 1 Desember 2026 (asumsi). Durasi total: 8-10 minggu.

## Prinsip
- Backup DB + uploads sebelum tiap fase.
- Satu fase selesai → uji → baru lanjut.
- Fitur baru tidak digabung ke fase kritis.

> Progres per 27 Nov 2026: Fase 0 ✅, Fase 1 ✅, Fase 2 ✅, Fase 3 ✅, Fase 4 ⬜. Verifikasi terkini: `npm run lint` 0 error, `npm test` 30/30 lulus, `npm run test:smoke` 21/21 alur lulus, `npm run build` sukses. Catatan: laporan tinta harian Owner dan override konversi tinta via UI Owner masih menyusul. Rincian kode: `PENJELASAN_KODE_FUNGSI.md`.

## Fase 0 — Audit & Persiapan (Minggu 1)
- Audit kode, endpoint, dan bug list.
- Backup `db.json`, `uploads/`.
- Siapkan environment test + data dummy.
- Definisikan scope revisi (Bagian 1 & 2).

## Fase 1 — Pengamanan Kritis (Minggu 2-3)
- CRUD transaksional (ganti snapshot).
- Lock stok roll/tinta (FOR UPDATE).
- Proteksi `/uploads` dengan auth.
- Validasi `SESSION_SECRET`, `WA_BRIDGE_TOKEN`, `WHATSAPP_WEBHOOK_TOKEN`.
- Ganti password default seed.
- Backup sebelum reset JSON.

## Fase 2 — Stabilisasi Logika & Akses (Minggu 4-5)
- Fix `getActiveUser` (cek `active === true`).
- Filter non-billing untuk Advertising.
- Hapus `preset_url` bebas + URL mockup hardcoded.
- Token di header (5 laporan Owner).
- Form Edit Instansi (limit kredit, pajak).
- Validasi nota, finishing, gagal cetak, void nota.
- Validasi tanggal & ID.

## Fase 3 — UI/UX & Modul Admin (Minggu 6-7)
- Purchasing & Supplier (edit/nonaktif/detail PO).
- Sembunyikan "Review Desain" untuk Owner.
- Tab filter "Batal" & "Piutang" di AdminOrders.
- ErrorBoundary + 401 auto-logout.
- Sinkron badge antrean.

## Fase 4 — Fitur Lanjutan (Minggu 8-10)
- Scheduler harian (piutang, cleanup TIFF).
- Batch nesting + stock opname.
- Preflight desain (DPI/CMYK/bleed).
- Sub-tahap finishing berantai.
- Foto before/after + geo-tag SPK.
- Refactor `server.ts` + unit test pajak/diskon/stok/insentif.

## Workstream Revisi (paralel, mulai Minggu 2)
- Admin login langsung aktif (admin tunggal).
- Setting pajak peraturan Indonesia + opsi setting di pengaturan.
- Halaman khusus setting WhatsApp (admin).
- WA kirim preview/revisi + self-ACC otomatis.
- Upload TIFF per item & masal (definisikan logika grouping).
- Desainer wajib upload file editable (AI/PSD/CDR).
- Tidak pilih mesin (1 mesin).
- Perhitungan bahan operator (ukuran file .prn, update harian).
- Perhitungan tinta per galon 5L (6 roll @ 3.2x70m).
- Offcut input atau masuk stok wos.
- Finishing = QC, cetak ulang jika cacat, bukti foto, tanpa bahan pembantu.
- Status update otomatis admin/pelanggan/desainer.

## Milestone
- M1 (Minggu 3): Fondasi aman.
- M2 (Minggu 5): Logika stabil.
- M3 (Minggu 7): UI lengkap.
- M4 (Minggu 10): Go-live + fase 2.

## Risiko
- Perubahan skema data → migrasi.
- Upload massal TIFF → butuh desain grouping jelas.
- Bahan calculation → butuh validasi operator lapangan.

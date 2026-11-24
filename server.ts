import 'dotenv/config';
import express, { type Request, type Response, type NextFunction } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import multer from 'multer';
import { GoogleGenAI, Type } from '@google/genai';
import {
  store,
  round2,
  priceForCategory,
  computeUkuranKotor,
  STANDARD_ROLL_SPECS,
  INSENTIF_ROLES,
  INSENTIF_JENIS,
  type StoredUser,
} from './server/store.ts';
import {
  verifyPassword,
  hashPassword,
  signSessionToken,
  verifySessionToken,
  parseCookie,
} from './server/auth.ts';
import type {
  AuditLog,
  CustomerCategory,
  DesignStatus,
  ExpenseCategory,
  GoodsReceipt,
  InsentifJenis,
  InsentifRate,
  InsentifRole,
  Instansi,
  PaymentMethod,
  PaymentStatus,
  PrintBatch,
  PrintMachine,
  ProductionStatus,
  PurchaseOrder,
  PurchaseOrderItem,
  Shift,
  SpkFieldStatus,
  Supplier,
  SupplierPayment,
  SupplyItem,
  SupplyUsage,
  User,
  UserRole,
  WhatsAppEvent,
  WhatsappOutbox,
} from './src/types.ts';

const PORT = Number(process.env.PORT ?? 3000);
const SESSION_COOKIE = 'reffo_session';
const UPLOADS_DIR = path.resolve(process.cwd(), 'uploads');
const MAX_UPLOAD_MB = Math.max(1, Number(process.env.MAX_UPLOAD_MB ?? 20));
const WHATSAPP_WEBHOOK_URL = String(process.env.WHATSAPP_WEBHOOK_URL ?? '').trim();
const WHATSAPP_WEBHOOK_TOKEN = String(process.env.WHATSAPP_WEBHOOK_TOKEN ?? '').trim();
const AUTO_CLEAN_TIFF_HARI = Math.max(1, Number(process.env.AUTO_CLEAN_TIFF_HARI ?? 90));
const PAJAK_REKLAME_HARI = Math.min(365, Math.max(0, Number(process.env.PAJAK_REKLAME_HARI ?? 30)));
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

function demoSwitchEnabled(): boolean {
  return (process.env.ENABLE_DEMO_SWITCH ?? 'true').trim().toLowerCase() !== 'false';
}

const ALLOWED_UPLOAD_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.png', '.webp', '.gif', '.pdf',
  '.tif', '.tiff', '.ai', '.psd', '.cdr', '.zip', '.rar',
]);

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
    filename: (_req, file, cb) => {
      const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
      cb(null, `${Date.now()}-${safeName}`);
    },
  }),
  limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const mime = (file.mimetype ?? '').toLowerCase();
    const mimeOk =
      mime.startsWith('image/') ||
      [
        'application/pdf',
        'application/postscript',
        'application/illustrator',
        'application/photoshop',
        'application/zip',
        'application/x-zip-compressed',
        'application/x-rar-compressed',
        'application/vnd.rar',
        'application/octet-stream',
        'application/x-coreldraw',
      ].includes(mime);
    if (!ALLOWED_UPLOAD_EXTENSIONS.has(ext) || !mimeOk) {
      cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE', file.fieldname));
      return;
    }
    cb(null, true);
  },
});


const sseClients = new Set<Response>();

function broadcastEvent(type: string, detail: Record<string, unknown> = {}) {
  if (sseClients.size === 0) return;
  const payload = JSON.stringify({
    type,
    at: new Date().toISOString(),
    ...detail,
  });
  for (const client of sseClients) {
    try {
      client.write(`event: domain_update\ndata: ${payload}\n\n`);
    } catch {
      sseClients.delete(client);
    }
  }
}

function sanitizeUser(u: StoredUser): User {
  return { id: u.id, name: u.name, email: u.email, role: u.role, active: u.active !== false };
}

function extractToken(req: Request): string | null {
  const authHeader = req.header('authorization');
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const bearer = authHeader.slice(7).trim();
    if (bearer) return bearer;
  }
  const cookieToken = parseCookie(req.header('cookie'), SESSION_COOKIE);
  if (cookieToken) return cookieToken;
  const queryToken = typeof req.query.token === 'string' ? req.query.token.trim() : '';
  return queryToken || null;
}

function getActiveUser(req: Request): StoredUser | null {
  const token = extractToken(req);
  const payload = verifySessionToken(token);
  if (!payload) return null;
  return store.getState().users.find((u) => u.id === payload.uid) ?? null;
}

function setSessionCookie(res: Response, token: string) {
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${7 * 24 * 60 * 60}`,
  );
}

function clearSessionCookie(res: Response) {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

function requireAuth(roles?: User['role'][]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = getActiveUser(req);
    if (!user) {
      res.status(401).json({ error: 'Sesi tidak valid atau telah berakhir. Silakan masuk kembali.' });
      return;
    }
    if (roles && !roles.includes(user.role)) {
      res.status(403).json({ error: `Akses ditolak untuk peran ${user.role}.` });
      return;
    }
    (req as Request & { currentUser: StoredUser }).currentUser = user;
    next();
  };
}

function getCurrentUser(req: Request): StoredUser {
  return (req as Request & { currentUser: StoredUser }).currentUser;
}

function clientIp(req: Request): string | null {
  const forwarded = req.header('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0]?.trim() ?? null;
  return req.socket?.remoteAddress ?? null;
}

function recordAudit(
  user: StoredUser | null,
  action: string,
  entity: string,
  entityId: number | null,
  detail: string,
  ip: string | null = null,
): AuditLog {
  const db = store.getState();
  const log: AuditLog = {
    id: store.nextId('audit_logs'),
    user_id: user?.id ?? 0,
    user_name: user?.name ?? 'Publik/Sistem',
    role: user?.role ?? 'admin',
    action,
    entity,
    entity_id: entityId,
    detail,
    created_at: new Date().toISOString(),
    ip,
  };
  db.audit_logs.push(log);
  if (db.audit_logs.length > 5000) {
    db.audit_logs.splice(0, db.audit_logs.length - 5000);
  }
  return log;
}

function auditRequest(
  req: Request,
  action: string,
  entity: string,
  entityId: number | null,
  detail: string,
): AuditLog {
  const current = (req as Request & { currentUser?: StoredUser }).currentUser ?? null;
  return recordAudit(current, action, entity, entityId, detail, clientIp(req));
}

function appBaseUrl(): string {
  return String(process.env.APP_URL ?? `http://localhost:${PORT}`).replace(/\/+$/, '');
}

function normalizeWaNumber(value: unknown): string {
  const digits = String(value ?? '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('0')) return `62${digits.slice(1)}`;
  if (digits.startsWith('62')) return digits;
  if (digits.startsWith('8')) return `62${digits}`;
  return digits;
}

function enqueueWa(
  event: WhatsAppEvent,
  dedupeKey: string,
  noWa: string,
  pesan: string,
  orderId: number | null = null,
  link: string | null = null,
): WhatsappOutbox | null {
  const db = store.getState();
  const nomor = normalizeWaNumber(noWa);
  if (!nomor || db.whatsapp_outbox.some((w) => w.dedupe_key === dedupeKey)) return null;
  const now = new Date().toISOString();
  const row: WhatsappOutbox = {
    id: store.nextId('whatsapp_outbox'),
    event,
    dedupe_key: dedupeKey,
    order_id: orderId,
    no_wa: nomor,
    pesan,
    link,
    status: 'pending',
    attempts: 0,
    last_error: WHATSAPP_WEBHOOK_URL ? null : 'Gateway WhatsApp belum dikonfigurasi (WHATSAPP_WEBHOOK_URL).',
    next_attempt_at: null,
    created_at: now,
    updated_at: now,
    sent_at: null,
  };
  db.whatsapp_outbox.push(row);
  store.persist();
  broadcastEvent('whatsapp_outbox_updated', { orderId });
  return row;
}

function enqueueSiapDiambil(orderId: number): void {
  const db = store.getState();
  const order = db.orders.find((o) => o.id === orderId);
  if (!order || !store.isOrderSiapDiambil(store.hydrateOrder(order))) return;
  const customer = db.customers.find((c) => c.id === order.customer_id);
  enqueueWa(
    'siap_diambil',
    `siap_diambil:${order.id}`,
    customer?.no_wa ?? '',
    `Nota ${order.no_nota} sudah siap diambil. Silakan datang ke Reffo PrintFlow.`,
    order.id,
    `${appBaseUrl()}/?nota=${order.no_nota}`,
  );
}

let waWorkerRunning = false;
async function deliverWaOutbox(): Promise<void> {
  if (waWorkerRunning) return;
  waWorkerRunning = true;
  try {
    const db = store.getState();
    const now = Date.now();
    const pending = db.whatsapp_outbox.filter(
      (w) =>
        w.status === 'pending' &&
        (!w.next_attempt_at || new Date(w.next_attempt_at).getTime() <= now),
    );
    if (pending.length === 0) return;
    let changed = false;

    for (const w of pending) {
      if (!WHATSAPP_WEBHOOK_URL) {
        const error = 'Gateway WhatsApp belum dikonfigurasi (WHATSAPP_WEBHOOK_URL).';
        if (w.last_error !== error) {
          w.last_error = error;
          w.updated_at = new Date().toISOString();
          changed = true;
        }
        continue;
      }
      try {
        const response = await fetch(WHATSAPP_WEBHOOK_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(WHATSAPP_WEBHOOK_TOKEN ? { Authorization: `Bearer ${WHATSAPP_WEBHOOK_TOKEN}` } : {}),
          },
          body: JSON.stringify({
            event: w.event,
            to: w.no_wa,
            message: w.pesan,
            link: w.link,
            dedupe_key: w.dedupe_key,
          }),
        });
        if (!response.ok) throw new Error(`Gateway menjawab HTTP ${response.status}`);
        w.status = 'terkirim';
        w.sent_at = new Date().toISOString();
        w.last_error = null;
        w.next_attempt_at = null;
        changed = true;
      } catch (err) {
        w.attempts = (w.attempts ?? 0) + 1;
        w.last_error = err instanceof Error ? err.message : String(err);
        w.status = w.attempts >= 3 ? 'gagal' : 'pending';
        w.next_attempt_at = new Date(Date.now() + w.attempts * 60_000).toISOString();
        changed = true;
      }
      w.updated_at = new Date().toISOString();
    }

    if (changed) {
      store.persist();
      broadcastEvent('whatsapp_outbox_updated');
    }
  } finally {
    waWorkerRunning = false;
  }
}

function hapusTiffLama(
  hari: number,
  pelaku: StoredUser | null,
  keringanan: boolean,
): Array<{ order_id: number; item_id: number; no_nota: string; file: string; dihapus: boolean; alasan: string | null }> {
  const db = store.getState();
  const batas = Date.now() - Math.max(1, hari) * 86_400_000;
  const hasil: Array<{ order_id: number; item_id: number; no_nota: string; file: string; dihapus: boolean; alasan: string | null }> = [];
  const sudahDihapus = new Set<string>();
  let berubah = false;

  for (const item of db.order_items) {
    if (!item.file_cetak_tiff || item.status_produksi !== 'selesai') continue;
    const order = db.orders.find((o) => o.id === item.order_id);
    if (!order || !activeOrderRaw(order) || !order.waktu_serah_terima) continue;
    if (new Date(order.waktu_serah_terima).getTime() > batas) continue;

    const namaFile = path.basename(item.file_cetak_tiff);
    const target = path.join(UPLOADS_DIR, namaFile);
    let aman = false;
    try {
      aman = fs.statSync(target).isFile();
    } catch {
      aman = false;
    }
    const alasan = !namaFile || namaFile.startsWith('.')
      ? 'Nama file TIFF tidak valid.'
      : !aman
        ? 'File tidak ditemukan di folder uploads/.'
        : sudahDihapus.has(namaFile)
          ? 'File sudah dihapus dari entri sebelumnya.'
          : null;

    let dihapus = false;
    if (!keringanan && aman && !alasan) {
      fs.unlinkSync(target);
      sudahDihapus.add(namaFile);
      item.file_cetak_tiff = null;
      item.updated_at = new Date().toISOString();
      recordAudit(pelaku, 'auto_clean_tiff', 'order_item', item.id, `TIFF lama dihapus: ${namaFile} (${order.no_nota})`);
      dihapus = true;
      berubah = true;
    }
    hasil.push({
      order_id: order.id,
      item_id: item.id,
      no_nota: order.no_nota,
      file: namaFile,
      dihapus,
      alasan,
    });
  }

  if (berubah) {
    store.persist();
    broadcastEvent('maintenance_updated');
  }
  return hasil;
}

function clampPercent(value: unknown): number {
  const num = Number(value ?? 0);
  if (!Number.isFinite(num)) return 0;
  return Math.min(Math.max(round2(num), 0), 100);
}

function generateApprovalToken(): string {
  return crypto.randomBytes(18).toString('hex');
}

function getOpenShiftFor(kasirId: number): Shift | null {
  const db = store.getState();
  return (
    db.shifts.find((s) => s.kasir_id === kasirId && s.status === 'buka') ?? null
  );
}

function computeShiftExpectation(shift: Shift): {
  tunai: number;
  transfer: number;
  qris: number;
} {
  const db = store.getState();
  const payments = db.order_payments.filter((p) => p.shift_id === shift.id);
  const tunai = round2(
    shift.opening_cash +
      payments.filter((p) => p.metode === 'Tunai').reduce((s, p) => s + p.nominal, 0),
  );
  const transfer = round2(
    payments.filter((p) => p.metode === 'Transfer').reduce((s, p) => s + p.nominal, 0),
  );
  const qris = round2(
    payments.filter((p) => p.metode === 'QRIS').reduce((s, p) => s + p.nominal, 0),
  );
  return { tunai, transfer, qris };
}

function hydrateShift(shift: Shift): Shift {
  const kasir = store.getState().users.find((u) => u.id === shift.kasir_id);
  return { ...shift, kasir_name: kasir?.name ?? 'Kasir' };
}

function activeOrderRaw(order: { status_nota?: 'aktif' | 'batal' }): boolean {
  return (order.status_nota ?? 'aktif') !== 'batal';
}

type DbState = ReturnType<typeof store.getState>;

function tanggalQuery(value: unknown): string | null {
  const text = String(value ?? '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function dalamRentang(iso: string, dari: string | null, sampai: string | null): boolean {
  const tanggal = String(iso ?? '').slice(0, 10);
  return (!dari || tanggal >= dari) && (!sampai || tanggal <= sampai);
}

const STATUS_ITEM_SELESAI: Record<InsentifRole, Set<string>> = {
  desainer: new Set(['antrean_cetak', 'proses_cetak', 'antrean_finishing', 'proses_finishing', 'siap_diambil', 'selesai']),
  operator_cetak: new Set(['antrean_finishing', 'proses_finishing', 'siap_diambil', 'selesai']),
  finishing: new Set(['siap_diambil', 'selesai']),
};

interface InsentifStafRow {
  user_id: number;
  nama: string;
  role: InsentifRole;
  total_item: number;
  item_selesai: number;
  job_selesai: number;
  tarif_item: number;
  tarif_job: number;
  insentif_item: number;
  insentif_job: number;
  total_insentif: number;
}

function hitungInsentif(
  db: DbState,
  dari: string | null,
  sampai: string | null,
): {
  dari: string | null;
  sampai: string | null;
  rates: InsentifRate[];
  staf: InsentifStafRow[];
  ringkasan: {
    jumlah_staf: number;
    total_item: number;
    total_item_selesai: number;
    total_job_selesai: number;
    total_insentif: number;
  };
} {
  const rates = Array.isArray(db.insentif_rates) ? db.insentif_rates : [];
  const tarif = (role: InsentifRole, jenis: InsentifJenis) =>
    Number(rates.find((r) => r.role === role && r.jenis === jenis)?.nominal ?? 0);
  const staf: InsentifStafRow[] = db.users
    .filter((u) => u.active !== false && INSENTIF_ROLES.includes(u.role as InsentifRole))
    .map((u) => {
      const role = u.role as InsentifRole;
      return {
        user_id: u.id,
        nama: u.name,
        role,
        total_item: 0,
        item_selesai: 0,
        job_selesai: 0,
        tarif_item: round2(tarif(role, 'per_item')),
        tarif_job: round2(tarif(role, 'per_job')),
        insentif_item: 0,
        insentif_job: 0,
        total_insentif: 0,
      };
    });
  const stafMap = new Map(staf.map((row) => [row.user_id, row]));
  const selesaiPerStaf = new Map<number, Set<number>>();

  for (const raw of db.orders) {
    if (!activeOrderRaw(raw) || !dalamRentang(raw.created_at, dari, sampai)) continue;
    const order = store.hydrateOrder(raw);
    for (const item of order.items) {
      for (const row of staf) {
        const ditugaskan =
          row.role === 'desainer'
            ? order.designer_id === row.user_id
            : row.role === 'operator_cetak'
              ? item.operator_id === row.user_id
              : item.finishing_user_id === row.user_id;
        if (!ditugaskan) continue;
        row.total_item += 1;
        if (!STATUS_ITEM_SELESAI[row.role].has(item.status_produksi)) continue;
        row.item_selesai += 1;
        if (!selesaiPerStaf.has(row.user_id)) selesaiPerStaf.set(row.user_id, new Set());
        selesaiPerStaf.get(row.user_id)!.add(order.id);
      }
    }
  }

  for (const row of staf) {
    row.job_selesai = selesaiPerStaf.get(row.user_id)?.size ?? 0;
    row.insentif_item = round2(row.item_selesai * row.tarif_item);
    row.insentif_job = round2(row.job_selesai * row.tarif_job);
    row.total_insentif = round2(row.insentif_item + row.insentif_job);
  }
  staf.sort((a, b) => b.total_insentif - a.total_insentif || a.nama.localeCompare(b.nama));

  return {
    dari,
    sampai,
    rates,
    staf,
    ringkasan: {
      jumlah_staf: stafMap.size,
      total_item: round2(staf.reduce((s, row) => s + row.total_item, 0)),
      total_item_selesai: round2(staf.reduce((s, row) => s + row.item_selesai, 0)),
      total_job_selesai: round2(staf.reduce((s, row) => s + row.job_selesai, 0)),
      total_insentif: round2(staf.reduce((s, row) => s + row.total_insentif, 0)),
    },
  };
}

interface PajakReklameRow {
  instansi_id: number;
  nama_instansi: string;
  pajak_reklame_expired: string | null;
  jatuh_tempo_berikutnya: string;
  tahun: number;
  hari_tersisa: number;
  no_wa: string;
  nama_pelanggan: string | null;
}

function parseTanggalIso(value: unknown): { tahun: number; bulan: number; tanggal: number } | null {
  const text = String(value ?? '').trim();
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const tahun = Number(match[1]);
  const bulan = Number(match[2]);
  const tanggal = Number(match[3]);
  if (bulan < 1 || bulan > 12 || tanggal < 1 || tanggal > 31) return null;
  const cek = new Date(Date.UTC(tahun, bulan - 1, tanggal));
  if (
    cek.getUTCFullYear() !== tahun ||
    cek.getUTCMonth() !== bulan - 1 ||
    cek.getUTCDate() !== tanggal
  ) {
    return null;
  }
  return { tahun, bulan, tanggal };
}

function jatuhTempoReklameBerikutnya(
  expired: unknown,
  sekarang: Date = new Date(),
): { jatuh_tempo: string; tahun: number; hari_tersisa: number } | null {
  const parsed = parseTanggalIso(expired);
  if (!parsed) return null;
  const hariIniUtc = Date.UTC(sekarang.getFullYear(), sekarang.getMonth(), sekarang.getDate());
  const akhirBulan = (tahun: number) => new Date(Date.UTC(tahun, parsed.bulan, 0)).getUTCDate();
  const buatUtc = (tahun: number) =>
    Date.UTC(tahun, parsed.bulan - 1, Math.min(parsed.tanggal, akhirBulan(tahun)));

  let tahun = parsed.tahun;
  let tempoUtc = buatUtc(tahun);
  if (tempoUtc < hariIniUtc) {
    tahun += 1;
    tempoUtc = buatUtc(tahun);
  }
  return {
    jatuh_tempo: new Date(tempoUtc).toISOString().slice(0, 10),
    tahun,
    hari_tersisa: Math.round((tempoUtc - hariIniUtc) / 86_400_000),
  };
}

function hitungPajakReklame(
  db: DbState,
  hari: number,
  sekarang: Date = new Date(),
): { semua: PajakReklameRow[]; items: PajakReklameRow[] } {
  const semua: PajakReklameRow[] = [];
  for (const inst of db.instansis) {
    const tempo = jatuhTempoReklameBerikutnya(inst.pajak_reklame_expired, sekarang);
    if (!tempo) continue;
    const pelanggan = db.customers.find(
      (c) => c.instansi_id === inst.id && normalizeWaNumber(c.no_wa),
    );
    semua.push({
      instansi_id: inst.id,
      nama_instansi: inst.nama_instansi,
      pajak_reklame_expired: inst.pajak_reklame_expired ?? null,
      jatuh_tempo_berikutnya: tempo.jatuh_tempo,
      tahun: tempo.tahun,
      hari_tersisa: tempo.hari_tersisa,
      no_wa: pelanggan?.no_wa ?? '',
      nama_pelanggan: pelanggan?.nama_pelanggan ?? null,
    });
  }
  semua.sort((a, b) => a.hari_tersisa - b.hari_tersisa || a.nama_instansi.localeCompare(b.nama_instansi));
  return { semua, items: semua.filter((row) => row.hari_tersisa <= hari) };
}

interface ProfitProdukRow {
  product_id: number;
  nama_produk: string;
  kategori_produk: string;
  jumlah_item: number;
  qty: number;
  omzet: number;
  hpp: number;
  laba_kotor: number;
  margin_persen: number;
}

interface ProfitKlienRow {
  instansi_id: number;
  instansi: string;
  jumlah_nota: number;
  jumlah_item: number;
  omzet: number;
  hpp: number;
  laba_kotor: number;
  margin_persen: number;
  total_tagihan: number;
  piutang: number;
}

function hitungProfitabilitas(
  db: DbState,
  dari: string | null,
  sampai: string | null,
): {
  dari: string | null;
  sampai: string | null;
  ringkasan: {
    jumlah_nota: number;
    jumlah_item: number;
    omzet: number;
    hpp: number;
    laba_kotor: number;
    margin_persen: number;
  };
  per_produk: ProfitProdukRow[];
  per_klien: ProfitKlienRow[];
} {
  const produkMap = new Map<number, ProfitProdukRow>();
  const klienMap = new Map<number, ProfitKlienRow>();
  let jumlahNota = 0;

  for (const raw of db.orders) {
    if (!activeOrderRaw(raw) || !dalamRentang(raw.created_at, dari, sampai)) continue;
    const order = store.hydrateOrder(raw);
    jumlahNota += 1;
    const instansiId = order.customer?.instansi_id ?? 0;
    const namaInstansi = order.customer?.instansi ?? 'Perorangan';
    if (!klienMap.has(instansiId)) {
      klienMap.set(instansiId, {
        instansi_id: instansiId,
        instansi: namaInstansi,
        jumlah_nota: 0,
        jumlah_item: 0,
        omzet: 0,
        hpp: 0,
        laba_kotor: 0,
        margin_persen: 0,
        total_tagihan: 0,
        piutang: 0,
      });
    }
    const klien = klienMap.get(instansiId)!;
    klien.jumlah_nota += 1;
    klien.total_tagihan = round2(klien.total_tagihan + order.total_tagihan);
    klien.piutang = round2(klien.piutang + order.sisa_tagihan);

    for (const item of order.items) {
      const product = db.products.find((p) => p.id === item.product_id);
      const qtyBasis =
        product?.kategori_produk === 'meteran' ? Number(item.luas_tagihan_m2 ?? 0) : Number(item.qty ?? 0);
      const hpp = round2(qtyBasis * Number(product?.harga_modal ?? 0));
      const productId = product?.id ?? item.product_id;
      if (!produkMap.has(productId)) {
        produkMap.set(productId, {
          product_id: productId,
          nama_produk: product?.nama_produk ?? item.nama_item ?? `Produk #${productId}`,
          kategori_produk: product?.kategori_produk ?? '-',
          jumlah_item: 0,
          qty: 0,
          omzet: 0,
          hpp: 0,
          laba_kotor: 0,
          margin_persen: 0,
        });
      }
      const produk = produkMap.get(productId)!;
      produk.jumlah_item += 1;
      produk.qty = round2(produk.qty + qtyBasis);
      produk.omzet = round2(produk.omzet + item.subtotal);
      produk.hpp = round2(produk.hpp + hpp);
      klien.jumlah_item += 1;
      klien.omzet = round2(klien.omzet + item.subtotal);
      klien.hpp = round2(klien.hpp + hpp);
    }
  }

  const finalisasi = <T extends { omzet: number; hpp: number; laba_kotor: number; margin_persen: number }>(
    row: T,
  ): T => {
    row.laba_kotor = round2(row.omzet - row.hpp);
    row.margin_persen = row.omzet > 0 ? round2((row.laba_kotor / row.omzet) * 100) : 0;
    return row;
  };
  const perProduk = Array.from(produkMap.values())
    .map(finalisasi)
    .sort((a, b) => b.laba_kotor - a.laba_kotor || a.nama_produk.localeCompare(b.nama_produk));
  const perKlien = Array.from(klienMap.values())
    .map(finalisasi)
    .sort((a, b) => b.laba_kotor - a.laba_kotor || a.instansi.localeCompare(b.instansi));
  const omzet = round2(perProduk.reduce((s, row) => s + row.omzet, 0));
  const hpp = round2(perProduk.reduce((s, row) => s + row.hpp, 0));
  const labaKotor = round2(omzet - hpp);

  return {
    dari,
    sampai,
    ringkasan: {
      jumlah_nota: jumlahNota,
      jumlah_item: perProduk.reduce((s, row) => s + row.jumlah_item, 0),
      omzet,
      hpp,
      laba_kotor: labaKotor,
      margin_persen: omzet > 0 ? round2((labaKotor / omzet) * 100) : 0,
    },
    per_produk: perProduk,
    per_klien: perKlien,
  };
}

const A3_PLUS_AREA_M2 = 0.159;

function selectInkSupply(
  db: ReturnType<typeof store.getState>,
  machine: PrintMachine | null | undefined,
): SupplyItem | null {
  const inks = db.supplies.filter((s) => s.aktif && s.kategori === 'tinta' && s.stok > 0);
  if (inks.length === 0) return null;
  const keyword =
    machine?.jenis === 'digital_a3p'
      ? 'a3p'
      : machine?.jenis === 'uv'
        ? 'uv'
        : machine?.jenis === 'large_format'
          ? 'solvent'
          : '';
  const preferred = keyword
    ? inks.find((s) => `${s.kode} ${s.nama}`.toLowerCase().includes(keyword))
    : null;
  return preferred ?? inks[0] ?? null;
}

function computeBatchNesting(
  items: Array<{
    id: number;
    qty: number;
    ukuran_kotor?: { lebar: number; tinggi: number; luas: number } | null;
  }>,
  rollWidth: number | null,
): {
  lebar_gabungan_m: number;
  panjang_tarik_m: number;
  luas_terpakai_m2: number;
  luas_waste_m2: number;
  penghematan_panjang_m: number;
  penghematan_luas_m2: number;
  lebar_sisa_m: number | null;
} {
  const widths: number[] = [];
  const pulls: number[] = [];
  for (const item of items) {
    const kotor = item.ukuran_kotor;
    if (!kotor) continue;
    widths.push(round2(kotor.lebar));
    pulls.push(round2(kotor.tinggi * item.qty));
  }
  const lebarGabungan = round2(widths.reduce((a, b) => a + b, 0));
  const panjangTarik = round2(Math.max(0, ...pulls));
  const luasTerpakai = round2(
    items.reduce((acc, item) => acc + (item.ukuran_kotor?.luas ?? 0) * item.qty, 0),
  );
  const lebarSisa = rollWidth === null ? null : round2(Math.max(rollWidth - lebarGabungan, 0));
  const luasWaste = lebarSisa === null ? 0 : round2(lebarSisa * panjangTarik);
  const penghematanPanjang = round2(pulls.reduce((a, b) => a + b, 0) - panjangTarik);
  return {
    lebar_gabungan_m: lebarGabungan,
    panjang_tarik_m: panjangTarik,
    luas_terpakai_m2: luasTerpakai,
    luas_waste_m2: luasWaste,
    penghematan_panjang_m: penghematanPanjang,
    penghematan_luas_m2: round2(penghematanPanjang * lebarGabungan),
    lebar_sisa_m: lebarSisa,
  };
}

function csvEscape(value: string | number | null | undefined): string {
  const text = value === null || value === undefined ? '' : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function toCsv(headers: string[], rows: Array<Array<string | number | null | undefined>>): string {
  return [headers, ...rows].map((row) => row.map(csvEscape).join(';')).join('\r\n');
}


function buildApp() {
  const app = express();
  app.use(express.json({ limit: '10mb' }));
  app.use('/uploads', express.static(UPLOADS_DIR));

  // --- AUTH ---
  app.get('/api/auth/accounts', (_req, res) => {
    const accounts = demoSwitchEnabled()
      ? store.getState().users.filter((u) => u.active !== false).map(sanitizeUser)
      : [];
    res.json({ accounts, demo_switch_enabled: demoSwitchEnabled() });
  });

  app.post('/api/auth/login', (req, res) => {
    const { email, password } = req.body as { email?: string; password?: string };
    const user = store
      .getState()
      .users.find(
        (u) => u.email.toLowerCase() === (email ?? '').trim().toLowerCase(),
      );
    if (!user || !verifyPassword(password ?? '', user.password)) {
      res.status(401).json({ error: 'Email atau kata sandi tidak sesuai.' });
      return;
    }
    if (user.active === false) {
      res.status(403).json({ error: 'Akun staf ini sudah dinonaktifkan. Hubungi Owner.' });
      return;
    }
    const token = signSessionToken(user.id, user.role);
    setSessionCookie(res, token);
    recordAudit(user, 'login', 'auth', user.id, `Login berhasil sebagai ${user.role}`, clientIp(req));
    store.persist();
    res.json({ user: sanitizeUser(user), token });
  });

  app.post('/api/auth/switch', (req, res) => {
    if (!demoSwitchEnabled()) {
      res.status(403).json({
        error: 'Demo switch dinonaktifkan pada mode produksi. Silakan login dengan email dan kata sandi.',
      });
      return;
    }
    const { userId } = req.body as { userId?: number };
    const user = store.getState().users.find((u) => u.id === Number(userId));
    if (!user) {
      res.status(404).json({ error: 'Akun divisi tidak ditemukan.' });
      return;
    }
    if (user.active === false) {
      res.status(403).json({ error: 'Akun staf ini sudah dinonaktifkan.' });
      return;
    }
    const token = signSessionToken(user.id, user.role);
    setSessionCookie(res, token);
    recordAudit(user, 'login_switch', 'auth', user.id, 'Login via demo switch', clientIp(req));
    store.persist();
    res.json({ user: sanitizeUser(user), token });
  });

  app.post('/api/auth/logout', (_req, res) => {
    clearSessionCookie(res);
    res.json({ ok: true });
  });

  // --- REAL-TIME SSE STREAM ---
  app.get('/api/events', requireAuth(), (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    res.write(`event: connected\ndata: ${JSON.stringify({ ok: true })}\n\n`);
    sseClients.add(res);

    const heartbeat = setInterval(() => {
      try {
        res.write(': ping\n\n');
      } catch {
        clearInterval(heartbeat);
        sseClients.delete(res);
      }
    }, 25_000);

    req.on('close', () => {
      clearInterval(heartbeat);
      sseClients.delete(res);
    });
  });

  // --- BOOTSTRAP MASTER DATA ---
  app.get('/api/bootstrap', requireAuth(), (req, res) => {
    const user = getCurrentUser(req);
    const db = store.getState();
    const shifts =
      user.role === 'owner'
        ? [...db.shifts]
            .sort((a, b) => new Date(b.opened_at).getTime() - new Date(a.opened_at).getTime())
            .slice(0, 60)
            .map(hydrateShift)
        : user.role === 'admin'
          ? db.shifts
              .filter((s) => s.kasir_id === user.id)
              .sort((a, b) => new Date(b.opened_at).getTime() - new Date(a.opened_at).getTime())
              .slice(0, 20)
              .map(hydrateShift)
          : [];
    res.json({
      user: sanitizeUser(user),
      products: db.products,
      finishings: db.finishings,
      instansis: db.instansis,
      customers: db.customers,
      rolls: db.material_rolls,
      offcuts: db.material_offcuts,
      machines: db.machines ?? [],
      supplies: db.supplies ?? [],
      demo_switch_enabled: demoSwitchEnabled(),
      shifts,
    });
  });

  // --- AI WHATSAPP ORDER PARSER ---
  app.post('/api/ai/parse-order', requireAuth(['admin']), async (req, res) => {
    const { text } = req.body as { text?: string };
    if (!text || !text.trim()) {
      res.status(400).json({ error: 'Teks pesan order tidak boleh kosong.' });
      return;
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      res.status(503).json({
        error: 'GEMINI_API_KEY belum dikonfigurasi pada Secrets panel untuk fitur ekstrak otomatis.',
      });
      return;
    }

    try {
      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
      });
      const db = store.getState();
      const productList = db.products.map((p) => `${p.id}:${p.nama_produk}(${p.kategori_produk})`).join(', ');
      const finishingList = db.finishings.map((f) => `${f.id}:${f.nama_finishing}`).join(', ');

      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: `Ekstrak data order percetakan dari pesan pelanggan berikut ke dalam JSON terstruktur.\nDaftar Produk (id:nama): ${productList}\nDaftar Finishing (id:nama): ${finishingList}\n\nPesan Pelanggan:\n${text}`,
        config: {
          systemInstruction:
            'Anda adalah asisten parsing order percetakan Indonesia. Cocokkan nama produk dan finishing ke ID yang paling mendekati. Ukuran selalu dalam meter (misal 300x100cm = 3.0 x 1.0 m). Jika kategori pelanggan tidak disebut, gunakan "umum".',
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              instansi: { type: Type.STRING, description: 'Nama instansi/perusahaan atau Perorangan' },
              nama_pelanggan: { type: Type.STRING },
              no_wa: { type: Type.STRING },
              kategori: { type: Type.STRING, description: 'umum | reseller | prioritas | pegawai' },
              catatan_desain: { type: Type.STRING },
              items: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    nama_item: { type: Type.STRING },
                    product_id: { type: Type.INTEGER },
                    finishing_id: { type: Type.INTEGER, nullable: true },
                    lebar_m: { type: Type.NUMBER, nullable: true },
                    tinggi_m: { type: Type.NUMBER, nullable: true },
                    qty: { type: Type.INTEGER },
                  },
                },
              },
            },
          },
        },
      });

      const parsed = JSON.parse((response.text ?? '{}').trim());
      res.json({ parsed });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Gagal memproses pesan dengan Gemini AI.';
      res.status(502).json({ error: msg });
    }
  });

  // --- ADMIN: INSTANSI & CUSTOMERS ---
  app.post('/api/instansis', requireAuth(['admin', 'owner']), (req, res) => {
    const body = req.body as {
      nama_instansi?: string;
      npwp?: string;
      is_pkp?: boolean;
      ppn_persen?: number;
      pph23_persen?: number;
      tempo_hari?: number;
      credit_limit?: number;
      pajak_reklame_expired?: string;
    };
    const nama = String(body.nama_instansi ?? '').trim();
    if (!nama) {
      res.status(400).json({ error: 'Nama instansi wajib diisi.' });
      return;
    }
    const db = store.getState();
    const existing = db.instansis.find(
      (i) => i.nama_instansi.toLowerCase() === nama.toLowerCase(),
    );
    if (existing) {
      res.json({ instansi: existing });
      return;
    }
    const instansi = {
      id: store.nextId('instansis'),
      nama_instansi: nama,
      npwp: body.npwp?.trim() || null,
      is_pkp: Boolean(body.is_pkp),
      ppn_persen: clampPercent(body.ppn_persen),
      pph23_persen: clampPercent(body.pph23_persen),
      tempo_hari: Math.max(0, Math.floor(Number(body.tempo_hari ?? 0)) || 0),
      credit_limit: Math.max(0, round2(Number(body.credit_limit ?? 0))),
      pajak_reklame_expired: body.pajak_reklame_expired || null,
    };
    db.instansis.push(instansi);
    auditRequest(req, 'instansi_create', 'instansi', instansi.id, `Instansi ${instansi.nama_instansi} dibuat`);
    store.persist();
    res.status(201).json({ instansi });
  });

  app.put('/api/instansis/:id', requireAuth(['admin', 'owner']), (req, res) => {
    const body = req.body as {
      nama_instansi?: string;
      npwp?: string | null;
      is_pkp?: boolean;
      ppn_persen?: number;
      pph23_persen?: number;
      tempo_hari?: number;
      credit_limit?: number;
      pajak_reklame_expired?: string | null;
    };
    const db = store.getState();
    const instansi = db.instansis.find((i) => i.id === Number(req.params.id));
    if (!instansi) {
      res.status(404).json({ error: 'Instansi tidak ditemukan.' });
      return;
    }
    if (body.nama_instansi !== undefined) {
      const nama = body.nama_instansi.trim();
      if (!nama) {
        res.status(422).json({ error: 'Nama instansi tidak boleh kosong.' });
        return;
      }
      instansi.nama_instansi = nama;
    }
    if (body.npwp !== undefined) instansi.npwp = body.npwp?.trim() || null;
    if (body.is_pkp !== undefined) instansi.is_pkp = Boolean(body.is_pkp);
    if (body.ppn_persen !== undefined) instansi.ppn_persen = clampPercent(body.ppn_persen);
    if (body.pph23_persen !== undefined) instansi.pph23_persen = clampPercent(body.pph23_persen);
    if (body.tempo_hari !== undefined) {
      instansi.tempo_hari = Math.max(0, Math.floor(Number(body.tempo_hari) || 0));
    }
    if (body.credit_limit !== undefined) {
      instansi.credit_limit = Math.max(0, round2(Number(body.credit_limit) || 0));
    }
    if (body.pajak_reklame_expired !== undefined) {
      instansi.pajak_reklame_expired = body.pajak_reklame_expired || null;
    }
    auditRequest(req, 'instansi_update', 'instansi', instansi.id, `Data pajak/kredit ${instansi.nama_instansi} diperbarui`);
    store.persist();
    res.json({ instansi });
  });

  // --- ORDERS LIST & DETAIL ---
  app.get('/api/orders', requireAuth(), (req, res) => {
    const user = getCurrentUser(req);
    const db = store.getState();
    const q = String(req.query.q ?? '').trim().toLowerCase();
    const tab = String(req.query.tab ?? 'semua');

    // Advertising is strictly non-billing: never expose prices to advertising role
    if (user.role === 'advertising') {
      res.status(403).json({ error: 'Gunakan endpoint SPK Advertising untuk divisi Advertising.' });
      return;
    }

    let hydrated = db.orders
      .map((o) => store.hydrateOrder(o))
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    if (q) {
      hydrated = hydrated.filter(
        (o) =>
          o.no_nota.toLowerCase().includes(q) ||
          (o.customer?.instansi ?? '').toLowerCase().includes(q) ||
          (o.customer?.nama_pelanggan ?? '').toLowerCase().includes(q),
      );
    }

    if (tab === 'produksi') {
      hydrated = hydrated.filter((o) => activeOrderRaw(o) && !store.isOrderSiapDiambil(o) && !store.isOrderSelesai(o));
    } else if (tab === 'siap_diambil') {
      hydrated = hydrated.filter((o) => store.isOrderSiapDiambil(o));
    } else if (tab === 'selesai') {
      hydrated = hydrated.filter((o) => store.isOrderSelesai(o));
    } else if (tab === 'batal') {
      hydrated = hydrated.filter((o) => o.status_nota === 'batal');
    } else if (tab === 'piutang') {
      hydrated = hydrated.filter((o) => activeOrderRaw(o) && o.sisa_tagihan > 0);
    }

    res.json({ orders: hydrated });
  });

  app.get('/api/orders/by-nota/:noNota', requireAuth(), (req, res) => {
    const user = getCurrentUser(req);
    const target = decodeURIComponent(String(req.params.noNota ?? '')).trim().toLowerCase();
    const raw = store.getState().orders.find((o) => o.no_nota.toLowerCase() === target);
    if (!raw) {
      res.status(404).json({ error: `Nota ${req.params.noNota} tidak ditemukan.` });
      return;
    }
    const order = store.hydrateOrder(raw);
    if (user.role === 'advertising') {
      res.json({
        order: {
          ...order,
          total_tagihan: 0,
          jumlah_dp: 0,
          sisa_tagihan: 0,
          payments: [],
          items: order.items.map((i) => ({ ...i, harga_satuan_dipakai: 0, subtotal: 0 })),
        },
      });
      return;
    }
    res.json({ order });
  });

  app.get('/api/orders/:id', requireAuth(), (req, res) => {
    const user = getCurrentUser(req);
    const id = Number(req.params.id);
    const raw = store.getState().orders.find((o) => o.id === id);
    if (!raw) {
      res.status(404).json({ error: 'Nota tidak ditemukan.' });
      return;
    }
    const order = store.hydrateOrder(raw);
    if (user.role === 'advertising') {
      res.json({
        order: {
          ...order,
          total_tagihan: 0,
          jumlah_dp: 0,
          sisa_tagihan: 0,
          payments: [],
          items: order.items.map((i) => ({ ...i, harga_satuan_dipakai: 0, subtotal: 0 })),
        },
      });
      return;
    }
    res.json({ order });
  });

  // --- ADMIN: CREATE ORDER ---
  app.post('/api/orders', requireAuth(['admin']), upload.single('lampiran_briefing'), (req, res) => {
    const admin = getCurrentUser(req);
    const db = store.getState();

    let payload: {
      customer_id?: number;
      instansi_id?: number;
      instansi?: string;
      nama_pelanggan: string;
      no_wa: string;
      kategori: CustomerCategory;
      alamat?: string;
      status_bayar: PaymentStatus;
      jumlah_dp?: number;
      status_desain: DesignStatus;
      catatan_desain?: string;
      deadline?: string;
      diskon_persen?: number;
      ppn_persen?: number;
      pph23_persen?: number;
      jatuh_tempo?: string;
      override_credit?: boolean;
      self_acc?: boolean;
      items: Array<{
        nama_item?: string;
        product_id: number;
        finishing_id?: number | null;
        lebar_m?: number | null;
        tinggi_m?: number | null;
        qty: number;
        diskon_persen?: number;
      }>;
      spk_enabled?: boolean;
      spk_jenis_pekerjaan?: string;
      spk_ukuran_konstruksi?: string;
      spk_lokasi_pasang?: string;
      spk_catatan_teknis?: string;
    };

    try {
      payload = typeof req.body.payload === 'string' ? JSON.parse(req.body.payload) : req.body;
    } catch {
      res.status(400).json({ error: 'Format data order tidak valid.' });
      return;
    }

    if (!payload.nama_pelanggan?.trim() || !payload.no_wa?.trim()) {
      res.status(422).json({ error: 'Nama pelanggan dan nomor WhatsApp wajib diisi.' });
      return;
    }
    if (!Array.isArray(payload.items) || payload.items.length === 0) {
      res.status(422).json({ error: 'Minimal harus ada 1 item pada nota.' });
      return;
    }

    // Resolve Instansi & Customer
    let instansiName = (payload.instansi ?? '').trim() || 'Perorangan';
    let instansiObj = payload.instansi_id
      ? db.instansis.find((i) => i.id === Number(payload.instansi_id))
      : db.instansis.find((i) => i.nama_instansi.toLowerCase() === instansiName.toLowerCase());

    if (!instansiObj) {
      instansiObj = { id: store.nextId('instansis'), nama_instansi: instansiName };
      db.instansis.push(instansiObj);
    } else {
      instansiName = instansiObj.nama_instansi;
    }

    let customer = payload.customer_id
      ? db.customers.find((c) => c.id === Number(payload.customer_id))
      : db.customers.find(
          (c) =>
            c.nama_pelanggan.toLowerCase() === payload.nama_pelanggan.trim().toLowerCase() &&
            c.instansi_id === instansiObj.id,
        );

    if (!customer) {
      customer = {
        id: store.nextId('customers'),
        instansi_id: instansiObj.id,
        instansi: instansiName,
        nama_pelanggan: payload.nama_pelanggan.trim(),
        no_wa: payload.no_wa.trim(),
        kategori: payload.kategori ?? 'umum',
        alamat: payload.alamat?.trim() || null,
      };
      db.customers.push(customer);
    } else {
      customer.instansi_id = instansiObj.id;
      customer.instansi = instansiName;
      customer.nama_pelanggan = payload.nama_pelanggan.trim();
      customer.no_wa = payload.no_wa.trim();
      customer.kategori = payload.kategori ?? customer.kategori;
      customer.alamat = payload.alamat?.trim() || customer.alamat;
    }

    const now = new Date().toISOString();
    let totalSebelumDiskonNota = 0;
    const builtItems: typeof db.order_items = [];

    for (const row of payload.items) {
      const product = db.products.find((p) => p.id === Number(row.product_id));
      if (!product) {
        res.status(422).json({ error: `Produk ID ${row.product_id} tidak ditemukan.` });
        return;
      }
      const qty = Math.max(1, Math.floor(Number(row.qty) || 1));
      const hargaSatuan = priceForCategory(product, customer.kategori);
      let lebar: number | null = null;
      let tinggi: number | null = null;
      let luasTagihan: number | null = null;
      let finishingId: number | null = null;
      let hargaSebelumDiskon = 0;

      if (product.kategori_produk === 'meteran') {
        lebar = round2(Number(row.lebar_m));
        tinggi = round2(Number(row.tinggi_m));
        if (!(lebar > 0) || !(tinggi > 0)) {
          res.status(422).json({ error: `Lebar dan tinggi wajib > 0 untuk produk meteran (${product.nama_produk}).` });
          return;
        }
        luasTagihan = round2(lebar * tinggi * qty);
        finishingId = row.finishing_id ? Number(row.finishing_id) : null;
        hargaSebelumDiskon = round2(hargaSatuan * luasTagihan);
      } else {
        hargaSebelumDiskon = round2(hargaSatuan * qty);
      }

      const itemDiskonPersen = clampPercent(row.diskon_persen);
      const itemDiskonNominal = round2((hargaSebelumDiskon * itemDiskonPersen) / 100);
      const subtotal = round2(hargaSebelumDiskon - itemDiskonNominal);
      totalSebelumDiskonNota = round2(totalSebelumDiskonNota + subtotal);

      builtItems.push({
        id: 0,
        order_id: 0,
        nama_item: row.nama_item?.trim() || null,
        product_id: product.id,
        finishing_id: finishingId,
        lebar_m: lebar,
        tinggi_m: tinggi,
        qty,
        luas_tagihan_m2: luasTagihan,
        harga_satuan_dipakai: hargaSatuan,
        harga_sebelum_diskon: hargaSebelumDiskon,
        diskon_persen: itemDiskonPersen,
        diskon_nominal: itemDiskonNominal,
        subtotal,
        status_produksi: 'menunggu_desain',
        machine_id: product.mesin_default_id ?? null,
        operator_id: null,
        finishing_user_id: null,
        waktu_mulai_cetak: null,
        waktu_selesai_cetak: null,
        klik_total:
          (product.satuan_hitung ?? 'pcs') === 'klik'
            ? qty * (product.klik_per_lembar ?? 1)
            : null,
        estimasi_tinta_ml: null,
        batch_id: null,
        satuan_hitung: product.satuan_hitung ?? 'pcs',
        klik_per_lembar: product.klik_per_lembar ?? 1,
        ukuran_lembar: product.ukuran_lembar ?? null,
        acc_admin_id: null,
        waktu_acc: null,
        file_preview_acc: null,
        file_cetak_tiff: null,
        file_master_arsip: null,
        created_at: now,
        updated_at: now,
      });
    }

    // Diskon nota + PPN/PPh 23 + jatuh tempo
    const diskonPersen = clampPercent(payload.diskon_persen);
    const diskonNominal = round2((totalSebelumDiskonNota * diskonPersen) / 100);
    const dpp = round2(totalSebelumDiskonNota - diskonNominal);
    const defaultPpn = instansiObj.is_pkp ? Number(instansiObj.ppn_persen ?? 11) : Number(instansiObj.ppn_persen ?? 0);
    const ppnPersen = clampPercent(payload.ppn_persen ?? defaultPpn);
    const pph23Persen = clampPercent(payload.pph23_persen ?? instansiObj.pph23_persen ?? 0);
    const ppnNominal = round2((dpp * ppnPersen) / 100);
    const pph23Nominal = round2((dpp * pph23Persen) / 100);
    const totalTagihan = round2(dpp + ppnNominal - pph23Nominal);

    const tempoHari = Math.max(0, Math.floor(Number(instansiObj.tempo_hari ?? 0)) || 0);
    const jatuhTempo = payload.jatuh_tempo
      ? new Date(payload.jatuh_tempo).toISOString()
      : tempoHari > 0
        ? new Date(Date.now() + tempoHari * 86400_000).toISOString()
        : null;

    // Batas kredit instansi (piutang aktif + nota baru)
    const creditLimit = Number(instansiObj.credit_limit ?? 0);
    if (creditLimit > 0 && (payload.status_bayar ?? 'belum_lunas') !== 'lunas') {
      const piutangAktif = round2(
        db.orders
          .filter((o) => o.customer_id === customer!.id && activeOrderRaw(o))
          .reduce((sum, o) => sum + Math.max(o.total_tagihan - o.jumlah_dp, 0), 0),
      );
      if (piutangAktif + totalTagihan > creditLimit && !payload.override_credit) {
        res.status(422).json({
          error:
            `Batas kredit ${instansiObj.nama_instansi} terlampaui. Piutang aktif Rp ${piutangAktif.toLocaleString('id-ID')} + nota baru Rp ${totalTagihan.toLocaleString('id-ID')} ` +
            `melebihi limit Rp ${creditLimit.toLocaleString('id-ID')}. Gunakan override kredit bila disetujui Owner.`,
          credit: { piutang_aktif: piutangAktif, limit: creditLimit, total_baru: totalTagihan },
        });
        return;
      }
    }

    // Payment validation
    let statusBayar: PaymentStatus = payload.status_bayar ?? 'belum_lunas';
    let jumlahDp = round2(Number(payload.jumlah_dp ?? 0));
    if (statusBayar === 'lunas') {
      jumlahDp = totalTagihan;
    } else if (statusBayar === 'belum_lunas') {
      jumlahDp = 0;
    } else {
      if (jumlahDp <= 0) {
        res.status(422).json({ error: 'Jumlah DP wajib lebih besar dari Rp 0 saat memilih status DP.' });
        return;
      }
      if (jumlahDp > totalTagihan) {
        res.status(422).json({ error: 'Jumlah DP tidak boleh melebihi total tagihan.' });
        return;
      }
      if (jumlahDp >= totalTagihan) {
        statusBayar = 'lunas';
        jumlahDp = totalTagihan;
      }
    }

    const orderId = store.nextId('orders');
    const approvalToken = payload.self_acc === false ? null : generateApprovalToken();
    const orderRecord: (typeof db.orders)[number] = {
      id: orderId,
      no_nota: store.generateNoNota(),
      customer_id: customer.id,
      user_id: admin.id,
      designer_id: null,
      total_tagihan: totalTagihan,
      jumlah_dp: jumlahDp,
      status_bayar: statusBayar,
      status_nota: 'aktif',
      alasan_batal: null,
      diskon_persen: diskonPersen,
      diskon_nominal: diskonNominal,
      ppn_persen: ppnPersen,
      ppn_nominal: ppnNominal,
      pph23_persen: pph23Persen,
      pph23_nominal: pph23Nominal,
      jatuh_tempo: jatuhTempo,
      approval_token: approvalToken,
      approval_status: approvalToken ? 'menunggu' : 'belum',
      approval_note: null,
      status_desain: payload.status_desain ?? 'belum_ada_file',
      catatan_desain: payload.catatan_desain?.trim() || null,
      lampiran_briefing: req.file ? `/uploads/${req.file.filename}` : null,
      file_master_arsip: null,
      waktu_terima_desain: null,
      waktu_selesai_desain: null,
      tanda_tangan_desainer: null,
      tanda_tangan_admin: null,
      bukti_pelunasan: null,
      foto_serah_terima: null,
      tanda_tangan_pengambil: null,
      nama_pengambil: null,
      no_wa_pengambil: null,
      waktu_serah_terima: null,
      catatan_pengecualian: null,
      deadline: payload.deadline ? new Date(payload.deadline).toISOString() : null,
      created_at: now,
      updated_at: now,
    };
    db.orders.push(orderRecord);

    for (const item of builtItems) {
      item.id = store.nextId('order_items');
      item.order_id = orderId;
      db.order_items.push(item);
    }

    if (jumlahDp > 0) {
      const openShift = getOpenShiftFor(admin.id);
      db.order_payments.push({
        id: store.nextId('order_payments'),
        order_id: orderId,
        tanggal: now.slice(0, 10),
        nominal: jumlahDp,
        metode: 'Tunai',
        keterangan: statusBayar === 'lunas' ? 'Pelunasan awal saat pembuatan nota' : 'Uang muka (DP) awal',
        bukti_bayar: null,
        admin_id: admin.id,
        shift_id: openShift?.id ?? null,
        created_at: now,
      });
    }

    if (payload.spk_enabled) {
      if (!payload.spk_jenis_pekerjaan?.trim() || !payload.spk_ukuran_konstruksi?.trim() || !payload.spk_lokasi_pasang?.trim()) {
        res.status(422).json({ error: 'Jenis pekerjaan, ukuran konstruksi, dan lokasi pasang SPK Advertising wajib diisi.' });
        return;
      }
      db.advertising_spks.push({
        id: store.nextId('advertising_spks'),
        order_id: orderId,
        jenis_pekerjaan: payload.spk_jenis_pekerjaan.trim(),
        ukuran_konstruksi: payload.spk_ukuran_konstruksi.trim(),
        lokasi_pasang: payload.spk_lokasi_pasang.trim(),
        catatan_teknis: payload.spk_catatan_teknis?.trim() || null,
        status_lapangan: 'antrean',
        created_at: now,
        updated_at: now,
      });
    }

    recordAudit(
      admin,
      'order_create',
      'order',
      orderId,
      `Nota ${orderRecord.no_nota} dibuat untuk ${customer.nama_pelanggan} senilai Rp ${totalTagihan.toLocaleString('id-ID')}`,
      clientIp(req),
    );
    store.persist();
    broadcastEvent('order_created', { orderId });
    enqueueWa(
      'nota_dibuat',
      `nota_dibuat:${orderId}`,
      customer.no_wa,
      `Nota ${orderRecord.no_nota} telah dibuat. Total tagihan Rp ${totalTagihan.toLocaleString('id-ID')}.`,
      orderId,
      approvalToken ? `${appBaseUrl()}/acc/${approvalToken}` : `${appBaseUrl()}/?nota=${orderRecord.no_nota}`,
    );
    res.status(201).json({ order: store.hydrateOrder(orderRecord) });
  });

  // --- ADMIN: DESIGN REVIEW (ACC / REVISI) ---
  app.get('/api/admin/design-reviews', requireAuth(['admin']), (_req, res) => {
    const db = store.getState();
    const orders = db.orders
      .map((o) => store.hydrateOrder(o))
      .filter((o) =>
        o.items.some((i) => i.status_produksi === 'menunggu_acc' || i.status_produksi === 'revisi'),
      )
      .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
    res.json({ orders });
  });

  app.post('/api/admin/design-reviews/:orderId/approve', requireAuth(['admin']), (req, res) => {
    const admin = getCurrentUser(req);
    const db = store.getState();
    const orderId = Number(req.params.orderId);
    const order = db.orders.find((o) => o.id === orderId);
    if (!order) {
      res.status(404).json({ error: 'Nota tidak ditemukan.' });
      return;
    }

    const waitingItems = db.order_items.filter(
      (i) => i.order_id === orderId && i.status_produksi === 'menunggu_acc',
    );
    if (waitingItems.length === 0) {
      res.status(422).json({ error: 'Tidak ada item yang sedang menunggu ACC Admin.' });
      return;
    }
    const now = new Date().toISOString();
    for (const item of waitingItems) {
      item.acc_admin_id = admin.id;
      item.waktu_acc = now;
      item.updated_at = now;
    }
    order.tanda_tangan_admin = admin.name;
    order.updated_at = now;
    store.persist();
    broadcastEvent('design_reviewed', { orderId });
    res.json({ order: store.hydrateOrder(order) });
  });

  app.post('/api/admin/design-reviews/:orderId/revise', requireAuth(['admin']), (req, res) => {
    const admin = getCurrentUser(req);
    const db = store.getState();
    const orderId = Number(req.params.orderId);
    const catatan = String((req.body as { catatan_revisi?: string }).catatan_revisi ?? '').trim();
    if (!catatan) {
      res.status(422).json({ error: 'Catatan revisi wajib diisi agar desainer mengetahui perbaikannya.' });
      return;
    }
    const order = db.orders.find((o) => o.id === orderId);
    if (!order) {
      res.status(404).json({ error: 'Nota tidak ditemukan.' });
      return;
    }
    const items = db.order_items.filter(
      (i) => i.order_id === orderId && (i.status_produksi === 'menunggu_acc' || i.status_produksi === 'proses_desain'),
    );
    if (items.length === 0) {
      res.status(422).json({ error: 'Tidak ada item yang dapat diajukan revisi.' });
      return;
    }

    const now = new Date().toISOString();
    const maxRev = db.design_revisions
      .filter((r) => r.order_id === orderId)
      .reduce((acc, r) => Math.max(acc, r.revisi_ke), 0);

    db.design_revisions.push({
      id: store.nextId('design_revisions'),
      order_id: orderId,
      order_item_id: null,
      revisi_ke: maxRev + 1,
      catatan_revisi: catatan,
      file_preview: items[0]?.file_preview_acc ?? null,
      admin_id: admin.id,
      status_revisi: 'menunggu',
      created_at: now,
    });

    for (const item of items) {
      item.status_produksi = 'revisi';
      item.acc_admin_id = null;
      item.waktu_acc = null;
      item.updated_at = now;
    }
    order.updated_at = now;
    store.persist();
    broadcastEvent('design_reviewed', { orderId });
    res.json({ order: store.hydrateOrder(order) });
  });

  // --- ADMIN: PEMBAYARAN BERTAHAP (TERMIN) & PELUNASAN ---
  app.post('/api/orders/:id/payments', requireAuth(['admin']), upload.single('bukti_bayar'), (req, res) => {
    const admin = getCurrentUser(req);
    const db = store.getState();
    const order = db.orders.find((o) => o.id === Number(req.params.id));
    if (!order) {
      res.status(404).json({ error: 'Nota tidak ditemukan.' });
      return;
    }
    if (order.status_nota === 'batal') {
      res.status(422).json({ error: 'Nota sudah dibatalkan (void) dan tidak dapat menerima pembayaran.' });
      return;
    }
    const sisa = round2(Math.max(order.total_tagihan - order.jumlah_dp, 0));
    if (order.status_bayar === 'lunas' || sisa <= 0) {
      res.status(422).json({ error: 'Tagihan nota ini sudah berstatus lunas.' });
      return;
    }
    const nominal = round2(Number((req.body as { nominal?: string | number }).nominal ?? 0));
    const metodeRaw = String((req.body as { metode?: string }).metode ?? 'Tunai') as PaymentMethod;
    const metode: PaymentMethod = ['Tunai', 'Transfer', 'QRIS'].includes(metodeRaw) ? metodeRaw : 'Tunai';
    const keterangan = String((req.body as { keterangan?: string }).keterangan ?? '').trim() || null;

    if (!(nominal > 0)) {
      res.status(422).json({ error: 'Nominal pembayaran termin wajib lebih dari Rp 0.' });
      return;
    }
    if (nominal > sisa + 1) {
      res.status(422).json({ error: `Nominal melebihi sisa tagihan (Rp ${sisa.toLocaleString('id-ID')}).` });
      return;
    }

    const now = new Date().toISOString();
    const actualNominal = Math.min(nominal, sisa);
    const buktiPath = req.file ? `/uploads/${req.file.filename}` : null;
    const openShift = getOpenShiftFor(admin.id);

    db.order_payments.push({
      id: store.nextId('order_payments'),
      order_id: order.id,
      tanggal: now.slice(0, 10),
      nominal: actualNominal,
      metode,
      keterangan,
      bukti_bayar: buktiPath,
      admin_id: admin.id,
      shift_id: openShift?.id ?? null,
      created_at: now,
    });

    order.jumlah_dp = round2(Math.min(order.total_tagihan, order.jumlah_dp + actualNominal));
    order.status_bayar = order.jumlah_dp >= order.total_tagihan ? 'lunas' : 'dp';
    if (order.status_bayar === 'lunas' && buktiPath) {
      order.bukti_pelunasan = buktiPath;
    }
    if (keterangan && order.status_bayar === 'lunas' && !order.catatan_pengecualian) {
      order.catatan_pengecualian = keterangan;
    }
    order.updated_at = now;
    recordAudit(
      admin,
      'payment_record',
      'order',
      order.id,
      `Pembayaran ${metode} Rp ${actualNominal.toLocaleString('id-ID')} untuk ${order.no_nota}`,
      clientIp(req),
    );
    store.persist();
    broadcastEvent('payment_recorded', { orderId: order.id });
    res.status(201).json({ order: store.hydrateOrder(order) });
  });

  app.post('/api/orders/:id/pelunasan', requireAuth(['admin']), upload.single('bukti_pelunasan'), (req, res) => {
    const admin = getCurrentUser(req);
    const db = store.getState();
    const order = db.orders.find((o) => o.id === Number(req.params.id));
    if (!order) {
      res.status(404).json({ error: 'Nota tidak ditemukan.' });
      return;
    }
    if (order.status_nota === 'batal') {
      res.status(422).json({ error: 'Nota sudah dibatalkan (void) dan tidak dapat dilunasi.' });
      return;
    }
    if (order.status_bayar === 'lunas' && order.bukti_pelunasan) {
      res.status(403).json({ error: 'Nota ini sudah lunas dan memiliki bukti pelunasan.' });
      return;
    }
    const now = new Date().toISOString();
    const catatan = String((req.body as { catatan_pengecualian?: string }).catatan_pengecualian ?? '').trim();
    const metodeRaw = String((req.body as { metode?: string }).metode ?? 'Tunai') as PaymentMethod;
    const metode: PaymentMethod = ['Tunai', 'Transfer', 'QRIS'].includes(metodeRaw) ? metodeRaw : 'Tunai';
    const sisa = round2(Math.max(order.total_tagihan - order.jumlah_dp, 0));
    const buktiPath = req.file ? `/uploads/${req.file.filename}` : null;
    const openShift = getOpenShiftFor(admin.id);

    if (sisa > 0) {
      db.order_payments.push({
        id: store.nextId('order_payments'),
        order_id: order.id,
        tanggal: now.slice(0, 10),
        nominal: sisa,
        metode,
        keterangan: catatan || 'Pelunasan penuh tagihan',
        bukti_bayar: buktiPath,
        admin_id: admin.id,
        shift_id: openShift?.id ?? null,
        created_at: now,
      });
    }

    order.jumlah_dp = order.total_tagihan;
    order.status_bayar = 'lunas';
    if (buktiPath) {
      order.bukti_pelunasan = buktiPath;
    }
    if (catatan) {
      order.catatan_pengecualian = catatan;
    }
    order.updated_at = now;
    recordAudit(
      admin,
      'payment_settle',
      'order',
      order.id,
      `Pelunasan ${metode} untuk ${order.no_nota} sebesar Rp ${sisa.toLocaleString('id-ID')}`,
      clientIp(req),
    );
    store.persist();
    broadcastEvent('payment_recorded', { orderId: order.id });
    res.json({ order: store.hydrateOrder(order) });
  });

  // --- ADMIN: VOID / REFUND & REORDER ---
  app.post('/api/orders/:id/void', requireAuth(['admin', 'owner']), (req, res) => {
    const actor = getCurrentUser(req);
    const db = store.getState();
    const order = db.orders.find((o) => o.id === Number(req.params.id));
    if (!order) {
      res.status(404).json({ error: 'Nota tidak ditemukan.' });
      return;
    }
    if (order.status_nota === 'batal') {
      res.status(422).json({ error: 'Nota ini sudah berstatus batal/void.' });
      return;
    }
    const alasan = String((req.body as { alasan_batal?: string }).alasan_batal ?? '').trim();
    if (!alasan) {
      res.status(422).json({ error: 'Alasan pembatalan wajib diisi untuk audit.' });
      return;
    }
    const sudahDibayar = round2(order.jumlah_dp);
    const now = new Date().toISOString();
    order.status_nota = 'batal';
    order.alasan_batal = alasan;
    order.updated_at = now;
    if (sudahDibayar > 0) {
      order.catatan_pengecualian =
        `VOID/REFUND: ${alasan}. Dana diterima Rp ${sudahDibayar.toLocaleString('id-ID')} wajib direfund.`;
    }
    for (const item of db.order_items) {
      if (item.order_id === order.id && item.status_produksi !== 'selesai') {
        item.updated_at = now;
      }
    }
    recordAudit(
      actor,
      'order_void',
      'order',
      order.id,
      `Nota ${order.no_nota} dibatalkan. Alasan: ${alasan}. Nilai dibayar Rp ${sudahDibayar.toLocaleString('id-ID')}`,
      clientIp(req),
    );
    store.persist();
    broadcastEvent('order_voided', { orderId: order.id });
    res.json({ order: store.hydrateOrder(order), refund_nominal: sudahDibayar });
  });

  app.post('/api/orders/:id/reorder', requireAuth(['admin']), (req, res) => {
    const admin = getCurrentUser(req);
    const db = store.getState();
    const source = db.orders.find((o) => o.id === Number(req.params.id));
    if (!source) {
      res.status(404).json({ error: 'Nota sumber tidak ditemukan.' });
      return;
    }
    const sourceCustomer = db.customers.find((c) => c.id === source.customer_id);
    if (!sourceCustomer) {
      res.status(422).json({ error: 'Data pelanggan nota sumber tidak ditemukan.' });
      return;
    }
    const sourceItems = db.order_items.filter((i) => i.order_id === source.id);
    if (sourceItems.length === 0) {
      res.status(422).json({ error: 'Nota sumber tidak memiliki item untuk di-reorder.' });
      return;
    }

    const now = new Date().toISOString();
    let totalSebelumDiskonNota = 0;
    const built: typeof db.order_items = [];
    for (const old of sourceItems) {
      const product = db.products.find((p) => p.id === old.product_id);
      if (!product) continue;
      const hargaSatuan = priceForCategory(product, sourceCustomer.kategori);
      const hargaSebelumDiskon =
        product.kategori_produk === 'meteran'
          ? round2(hargaSatuan * (old.luas_tagihan_m2 ?? 0))
          : round2(hargaSatuan * old.qty);
      const diskonPersen = clampPercent(old.diskon_persen);
      const diskonNominal = round2((hargaSebelumDiskon * diskonPersen) / 100);
      const subtotal = round2(hargaSebelumDiskon - diskonNominal);
      totalSebelumDiskonNota = round2(totalSebelumDiskonNota + subtotal);
      built.push({
        ...old,
        id: 0,
        order_id: 0,
        harga_satuan_dipakai: hargaSatuan,
        harga_sebelum_diskon: hargaSebelumDiskon,
        diskon_persen: diskonPersen,
        diskon_nominal: diskonNominal,
        subtotal,
        status_produksi: 'menunggu_desain',
        acc_admin_id: null,
        waktu_acc: null,
        file_preview_acc: null,
        file_cetak_tiff: null,
        file_master_arsip: null,
        created_at: now,
        updated_at: now,
      });
    }
    if (built.length === 0) {
      res.status(422).json({ error: 'Produk pada nota sumber sudah tidak tersedia.' });
      return;
    }

    const diskonPersen = clampPercent(source.diskon_persen);
    const diskonNominal = round2((totalSebelumDiskonNota * diskonPersen) / 100);
    const dpp = round2(totalSebelumDiskonNota - diskonNominal);
    const ppnPersen = clampPercent(source.ppn_persen);
    const pph23Persen = clampPercent(source.pph23_persen);
    const ppnNominal = round2((dpp * ppnPersen) / 100);
    const pph23Nominal = round2((dpp * pph23Persen) / 100);
    const totalTagihan = round2(dpp + ppnNominal - pph23Nominal);
    const orderId = store.nextId('orders');
    const approvalToken = generateApprovalToken();
    const record: (typeof db.orders)[number] = {
      id: orderId,
      no_nota: store.generateNoNota(),
      customer_id: source.customer_id,
      user_id: admin.id,
      designer_id: null,
      total_tagihan: totalTagihan,
      jumlah_dp: 0,
      status_bayar: 'belum_lunas',
      status_nota: 'aktif',
      alasan_batal: null,
      diskon_persen: diskonPersen,
      diskon_nominal: diskonNominal,
      ppn_persen: ppnPersen,
      ppn_nominal: ppnNominal,
      pph23_persen: pph23Persen,
      pph23_nominal: pph23Nominal,
      jatuh_tempo: null,
      approval_token: approvalToken,
      approval_status: 'menunggu',
      approval_note: null,
      status_desain: 'belum_ada_file',
      catatan_desain: source.catatan_desain,
      lampiran_briefing: null,
      file_master_arsip: null,
      waktu_terima_desain: null,
      waktu_selesai_desain: null,
      tanda_tangan_desainer: null,
      tanda_tangan_admin: null,
      bukti_pelunasan: null,
      foto_serah_terima: null,
      tanda_tangan_pengambil: null,
      nama_pengambil: null,
      no_wa_pengambil: null,
      waktu_serah_terima: null,
      catatan_pengecualian: `Reorder dari ${source.no_nota}`,
      deadline: null,
      created_at: now,
      updated_at: now,
    };
    db.orders.push(record);
    for (const item of built) {
      item.id = store.nextId('order_items');
      item.order_id = orderId;
      db.order_items.push(item);
    }
    recordAudit(
      admin,
      'order_reorder',
      'order',
      orderId,
      `Reorder ${record.no_nota} dari ${source.no_nota}`,
      clientIp(req),
    );
    store.persist();
    broadcastEvent('order_created', { orderId });
    const reordered = store.hydrateOrder(record);
    enqueueWa(
      'nota_dibuat',
      `nota_dibuat:${orderId}`,
      reordered.customer?.no_wa ?? '',
      `Nota ${record.no_nota} dibuat ulang dari ${source.no_nota}. Total tagihan Rp ${record.total_tagihan.toLocaleString('id-ID')}.`,
      orderId,
      record.approval_token ? `${appBaseUrl()}/acc/${record.approval_token}` : `${appBaseUrl()}/?nota=${record.no_nota}`,
    );
    res.status(201).json({ order: reordered, source_no_nota: source.no_nota });
  });

  // --- PUBLIC SELF-ACC PORTAL (TANPA LOGIN, TOKEN ACAK) ---
  app.get('/api/public/approval/:token', (req, res) => {
    const token = String(req.params.token ?? '').trim();
    const db = store.getState();
    const raw = db.orders.find((o) => o.approval_token && o.approval_token === token);
    if (!raw) {
      res.status(404).json({ error: 'Link persetujuan tidak valid atau sudah kedaluwarsa.' });
      return;
    }
    const order = store.hydrateOrder(raw);
    const customer = order.customer;
    const disetujui = order.approval_status === 'disetujui';
    const instansiId = customer?.instansi_id ?? null;
    const tagihanLain = db.orders
      .filter((o) => o.id !== raw.id && (o.status_nota ?? 'aktif') !== 'batal')
      .map((o) => store.hydrateOrder(o))
      .filter((o) => o.sisa_tagihan > 0)
      .filter(
        (o) =>
          o.customer_id === raw.customer_id ||
          (instansiId !== null && o.customer?.instansi_id === instansiId),
      )
      .sort((a, b) =>
        (a.jatuh_tempo ?? a.created_at).localeCompare(b.jatuh_tempo ?? b.created_at),
      )
      .slice(0, 10)
      .map((o) => ({
        no_nota: o.no_nota,
        created_at: o.created_at,
        jatuh_tempo: o.jatuh_tempo ?? null,
        total_tagihan: o.total_tagihan,
        jumlah_dp: o.jumlah_dp,
        sisa_tagihan: o.sisa_tagihan,
        status_bayar: o.status_bayar,
      }));
    const sisaLain = round2(tagihanLain.reduce((sum, row) => sum + row.sisa_tagihan, 0));
    res.json({
      order: {
        no_nota: order.no_nota,
        instansi: customer?.instansi ?? 'Perorangan',
        nama_pelanggan: customer?.nama_pelanggan ?? '-',
        status_nota: order.status_nota ?? 'aktif',
        approval_status: order.approval_status ?? 'belum',
        approval_note: order.approval_note ?? null,
        approved_by: order.tanda_tangan_admin ?? null,
        catatan_desain: order.catatan_desain ?? null,
        lampiran_briefing: order.lampiran_briefing ?? null,
        created_at: order.created_at,
        updated_at: order.updated_at,
        total_tagihan: disetujui ? order.total_tagihan : 0,
        jumlah_dp: disetujui ? order.jumlah_dp : 0,
        sisa_tagihan: disetujui ? order.sisa_tagihan : 0,
        status_bayar: disetujui ? order.status_bayar : 'belum_lunas',
        diskon_persen: disetujui ? order.diskon_persen ?? 0 : 0,
        diskon_nominal: disetujui ? order.diskon_nominal ?? 0 : 0,
        ppn_persen: disetujui ? order.ppn_persen ?? 0 : 0,
        ppn_nominal: disetujui ? order.ppn_nominal ?? 0 : 0,
        pph23_persen: disetujui ? order.pph23_persen ?? 0 : 0,
        pph23_nominal: disetujui ? order.pph23_nominal ?? 0 : 0,
        dpp: disetujui
          ? round2(order.total_tagihan - (order.ppn_nominal ?? 0) + (order.pph23_nominal ?? 0))
          : 0,
        jatuh_tempo: order.jatuh_tempo ?? null,
        items: order.items.map((i) => ({
          id: i.id,
          nama_item: i.nama_item,
          product_name: i.product_name,
          product_category: i.product_category,
          qty: i.qty,
          lebar_m: i.lebar_m,
          tinggi_m: i.tinggi_m,
          luas_tagihan_m2: i.luas_tagihan_m2,
          satuan_hitung: i.satuan_hitung,
          klik_total: i.klik_total,
          finishing_name: i.finishing_name,
          harga_satuan: disetujui ? i.harga_satuan_dipakai : 0,
          harga_sebelum_diskon: disetujui ? i.harga_sebelum_diskon ?? i.harga_satuan_dipakai : 0,
          diskon_persen: disetujui ? i.diskon_persen ?? 0 : 0,
          diskon_nominal: disetujui ? i.diskon_nominal ?? 0 : 0,
          subtotal: disetujui ? i.subtotal : 0,
          file_preview_acc: i.file_preview_acc,
          status_produksi: i.status_produksi,
        })),
        design_revisions: order.design_revisions.slice(0, 5),
        payments: disetujui
          ? order.payments.map((p) => ({
              id: p.id,
              tanggal: p.tanggal,
              nominal: p.nominal,
              metode: p.metode,
              keterangan: p.keterangan ?? null,
              bukti_bayar: p.bukti_bayar ?? null,
              admin_name: p.admin_name ?? null,
            }))
          : [],
        tagihan_lain: disetujui ? tagihanLain : [],
        ringkasan_tagihan: {
          total_tagihan: disetujui ? order.total_tagihan : 0,
          sudah_dibayar: disetujui ? order.jumlah_dp : 0,
          sisa_tagihan: disetujui ? order.sisa_tagihan : 0,
          sisa_tagihan_lain: disetujui ? sisaLain : 0,
          total_harus_dibayar: disetujui ? round2(order.sisa_tagihan + sisaLain) : 0,
        },
      },
    });
  });

  app.post('/api/public/approval/:token', (req, res) => {
    const token = String(req.params.token ?? '').trim();
    const body = req.body as { decision?: 'disetujui' | 'revisi'; note?: string; nama?: string };
    const db = store.getState();
    const order = db.orders.find((o) => o.approval_token && o.approval_token === token);
    if (!order) {
      res.status(404).json({ error: 'Link persetujuan tidak valid atau sudah kedaluwarsa.' });
      return;
    }
    if (order.status_nota === 'batal') {
      res.status(422).json({ error: 'Nota ini sudah dibatalkan.' });
      return;
    }
    if (order.approval_status === 'disetujui') {
      res.status(409).json({ error: 'Nota ini sudah disetujui. Keputusan tidak dapat diubah.' });
      return;
    }
    const decision = body.decision;
    if (decision !== 'disetujui' && decision !== 'revisi') {
      res.status(422).json({ error: 'Keputusan harus "disetujui" atau "revisi".' });
      return;
    }
    const note = String(body.note ?? '').trim();
    if (decision === 'revisi' && !note) {
      res.status(422).json({ error: 'Mohon tuliskan catatan revisi yang diinginkan.' });
      return;
    }
    const now = new Date().toISOString();
    order.approval_status = decision;
    order.approval_note = note || null;
    order.updated_at = now;
    const items = db.order_items.filter((i) => i.order_id === order.id);
    if (decision === 'disetujui') {
      // Persetujuan pelanggan dicatat; ACC internal tetap dijalankan Admin
      // agar desainer dapat mengunggah TIFF final sebelum masuk antrean cetak.
      order.tanda_tangan_admin = body.nama?.trim() || order.tanda_tangan_admin;
    } else {
      for (const item of items) {
        if (item.status_produksi === 'menunggu_acc' || item.status_produksi === 'proses_desain') {
          item.status_produksi = 'revisi';
          item.updated_at = now;
        }
      }
      const maxRev = db.design_revisions
        .filter((r) => r.order_id === order.id)
        .reduce((acc, r) => Math.max(acc, r.revisi_ke), 0);
      db.design_revisions.push({
        id: store.nextId('design_revisions'),
        order_id: order.id,
        order_item_id: null,
        revisi_ke: maxRev + 1,
        catatan_revisi: `Revisi dari pelanggan${body.nama ? ` (${body.nama})` : ''}: ${note}`,
        file_preview: items[0]?.file_preview_acc ?? null,
        admin_id: null,
        status_revisi: 'menunggu',
        created_at: now,
      });
    }
    recordAudit(
      null,
      `self_acc_${decision}`,
      'order',
      order.id,
      `Pelanggan ${body.nama ?? order.no_nota} memberi keputusan ${decision}${note ? `: ${note}` : ''}`,
      clientIp(req),
    );
    store.persist();
    broadcastEvent('design_reviewed', { orderId: order.id });
    res.json({
      ok: true,
      approval_status: decision,
      message:
        decision === 'disetujui'
          ? 'Pesanan disetujui. Nota elektronik dan rincian tagihan kini ditampilkan.'
          : 'Catatan revisi terkirim ke tim desain.',
    });
  });


  // --- SHIFT / TUTUP KASIR HARIAN ---
  app.get('/api/shifts/current', requireAuth(['admin']), (req, res) => {
    const user = getCurrentUser(req);
    const shift = getOpenShiftFor(user.id);
    if (!shift) {
      res.json({ shift: null });
      return;
    }
    const expected = computeShiftExpectation(shift);
    res.json({
      shift: hydrateShift({
        ...shift,
        expected_tunai: expected.tunai,
        expected_transfer: expected.transfer,
        expected_qris: expected.qris,
      }),
    });
  });

  app.get('/api/shifts', requireAuth(['admin', 'owner']), (req, res) => {
    const user = getCurrentUser(req);
    const db = store.getState();
    const dari = req.query.dari ? String(req.query.dari) : null;
    const sampai = req.query.sampai ? String(req.query.sampai) : null;
    let shifts = db.shifts.filter((s) => (user.role === 'owner' ? true : s.kasir_id === user.id));
    if (dari) shifts = shifts.filter((s) => s.opened_at.slice(0, 10) >= dari);
    if (sampai) shifts = shifts.filter((s) => s.opened_at.slice(0, 10) <= sampai);
    shifts = shifts.sort(
      (a, b) => new Date(b.opened_at).getTime() - new Date(a.opened_at).getTime(),
    );
    res.json({ shifts: shifts.map(hydrateShift) });
  });

  app.post('/api/shifts/open', requireAuth(['admin']), (req, res) => {
    const user = getCurrentUser(req);
    const openingCash = round2(Number((req.body as { opening_cash?: number }).opening_cash ?? 0));
    if (openingCash < 0) {
      res.status(422).json({ error: 'Saldo awal kas tidak boleh negatif.' });
      return;
    }
    if (getOpenShiftFor(user.id)) {
      res.status(422).json({ error: 'Masih ada shift terbuka. Tutup shift sebelumnya terlebih dahulu.' });
      return;
    }
    const now = new Date().toISOString();
    const shift: Shift = {
      id: store.nextId('shifts'),
      kasir_id: user.id,
      opened_at: now,
      closed_at: null,
      opening_cash: openingCash,
      expected_tunai: openingCash,
      expected_transfer: 0,
      expected_qris: 0,
      actual_tunai: 0,
      actual_transfer: 0,
      actual_qris: 0,
      selisih: 0,
      catatan: null,
      status: 'buka',
    };
    store.getState().shifts.push(shift);
    recordAudit(user, 'shift_open', 'shift', shift.id, `Shift dibuka dengan kas awal Rp ${openingCash.toLocaleString('id-ID')}`, clientIp(req));
    store.persist();
    broadcastEvent('shift_updated', { shiftId: shift.id });
    res.status(201).json({ shift: hydrateShift(shift) });
  });

  app.post('/api/shifts/:id/close', requireAuth(['admin', 'owner']), (req, res) => {
    const user = getCurrentUser(req);
    const db = store.getState();
    const shift = db.shifts.find((s) => s.id === Number(req.params.id));
    if (!shift) {
      res.status(404).json({ error: 'Shift tidak ditemukan.' });
      return;
    }
    if (user.role === 'admin' && shift.kasir_id !== user.id) {
      res.status(403).json({ error: 'Anda hanya dapat menutup shift milik sendiri.' });
      return;
    }
    if (shift.status === 'tutup') {
      res.status(422).json({ error: 'Shift ini sudah ditutup.' });
      return;
    }
    const body = req.body as {
      actual_tunai?: number;
      actual_transfer?: number;
      actual_qris?: number;
      catatan?: string;
    };
    const expected = computeShiftExpectation(shift);
    const actualTunai = round2(Number(body.actual_tunai ?? expected.tunai));
    const actualTransfer = round2(Number(body.actual_transfer ?? expected.transfer));
    const actualQris = round2(Number(body.actual_qris ?? expected.qris));
    if ([actualTunai, actualTransfer, actualQris].some((n) => !Number.isFinite(n) || n < 0)) {
      res.status(422).json({ error: 'Nominal hitung fisik kas tidak boleh negatif.' });
      return;
    }
    const now = new Date().toISOString();
    shift.closed_at = now;
    shift.expected_tunai = expected.tunai;
    shift.expected_transfer = expected.transfer;
    shift.expected_qris = expected.qris;
    shift.actual_tunai = actualTunai;
    shift.actual_transfer = actualTransfer;
    shift.actual_qris = actualQris;
    shift.selisih = round2(
      actualTunai + actualTransfer + actualQris - (expected.tunai + expected.transfer + expected.qris),
    );
    shift.catatan = String(body.catatan ?? '').trim() || null;
    shift.status = 'tutup';
    recordAudit(
      user,
      'shift_close',
      'shift',
      shift.id,
      `Shift ditutup. Ekspektasi Rp ${(expected.tunai + expected.transfer + expected.qris).toLocaleString('id-ID')}, aktual Rp ${(actualTunai + actualTransfer + actualQris).toLocaleString('id-ID')}, selisih Rp ${shift.selisih.toLocaleString('id-ID')}`,
      clientIp(req),
    );
    store.persist();
    broadcastEvent('shift_updated', { shiftId: shift.id });
    res.json({ shift: hydrateShift(shift) });
  });

  // --- DESAINER WORKFLOW ---
  app.get('/api/desainer/queue', requireAuth(['desainer']), (_req, res) => {
    const db = store.getState();
    const designStatuses: ProductionStatus[] = ['menunggu_desain', 'proses_desain', 'menunggu_acc', 'revisi'];
    const orders = db.orders
      .map((o) => store.hydrateOrder(o))
      .filter((o) => activeOrderRaw(o))
      .filter((o) => o.items.some((i) => designStatuses.includes(i.status_produksi)))
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    res.json({ orders });
  });

  app.post('/api/desainer/orders/:id/terima', requireAuth(['desainer']), (req, res) => {
    const desainer = getCurrentUser(req);
    const db = store.getState();
    const order = db.orders.find((o) => o.id === Number(req.params.id));
    if (!order) {
      res.status(404).json({ error: 'Nota tidak ditemukan.' });
      return;
    }
    const now = new Date().toISOString();
    order.designer_id = order.designer_id ?? desainer.id;
    order.waktu_terima_desain = order.waktu_terima_desain ?? now;
    order.updated_at = now;

    for (const item of db.order_items) {
      if (item.order_id === order.id && item.status_produksi === 'menunggu_desain') {
        item.status_produksi = 'proses_desain';
        item.updated_at = now;
      }
    }
    store.persist();
    broadcastEvent('design_updated', { orderId: order.id });
    res.json({ order: store.hydrateOrder(order) });
  });

  app.post('/api/desainer/orders/:id/preview', requireAuth(['desainer']), upload.single('file_preview'), (req, res) => {
    const db = store.getState();
    const order = db.orders.find((o) => o.id === Number(req.params.id));
    if (!order) {
      res.status(404).json({ error: 'Nota tidak ditemukan.' });
      return;
    }
    if (!order.designer_id && !order.waktu_terima_desain) {
      res.status(403).json({ error: 'Terima job terlebih dahulu sebelum mengunggah preview.' });
      return;
    }
    const previewUrl = req.file
      ? `/uploads/${req.file.filename}`
      : String((req.body as { preset_url?: string }).preset_url ?? '').trim();

    if (!previewUrl) {
      res.status(422).json({ error: 'File gambar preview (JPG/PNG) wajib diunggah.' });
      return;
    }

    const now = new Date().toISOString();
    for (const rev of db.design_revisions) {
      if (rev.order_id === order.id && rev.status_revisi === 'menunggu') {
        rev.status_revisi = 'selesai';
        rev.file_preview = previewUrl;
      }
    }
    const maxRev = db.design_revisions
      .filter((r) => r.order_id === order.id)
      .reduce((acc, r) => Math.max(acc, r.revisi_ke), 0);
    db.design_revisions.push({
      id: store.nextId('design_revisions'),
      order_id: order.id,
      order_item_id: null,
      revisi_ke: maxRev + 1,
      catatan_revisi: String((req.body as { catatan?: string }).catatan ?? 'Upload preview oleh Desainer').trim(),
      file_preview: previewUrl,
      admin_id: null,
      status_revisi: 'selesai',
      created_at: now,
    });

    for (const item of db.order_items) {
      if (
        item.order_id === order.id &&
        ['proses_desain', 'revisi', 'menunggu_acc'].includes(item.status_produksi)
      ) {
        item.file_preview_acc = previewUrl;
        item.status_produksi = 'menunggu_acc';
        item.acc_admin_id = null;
        item.waktu_acc = null;
        item.updated_at = now;
      }
    }
    if (order.approval_status === 'revisi') {
      order.approval_status = 'menunggu';
      order.approval_note = null;
      order.tanda_tangan_admin = null;
    }
    order.updated_at = now;
    store.persist();
    broadcastEvent('design_updated', { orderId: order.id });
    const previewOrder = store.hydrateOrder(order);
    enqueueWa(
      'preview_siap_acc',
      `preview_siap_acc:${order.id}:${previewUrl}`,
      previewOrder.customer?.no_wa ?? '',
      `Preview desain Nota ${order.no_nota} siap di-ACC. Silakan cek tautan berikut.`,
      order.id,
      order.approval_token ? `${appBaseUrl()}/acc/${order.approval_token}` : `${appBaseUrl()}/?nota=${order.no_nota}`,
    );
    res.json({ order: previewOrder });
  });

  app.post('/api/desainer/items/:itemId/tiff', requireAuth(['desainer']), upload.single('file_cetak_tiff'), (req, res) => {
    const db = store.getState();
    const item = db.order_items.find((i) => i.id === Number(req.params.itemId));
    if (!item) {
      res.status(404).json({ error: 'Item tidak ditemukan.' });
      return;
    }
    if (!item.acc_admin_id) {
      res.status(422).json({ error: 'Item wajib disetujui (ACC) Admin terlebih dahulu sebelum unggah TIFF.' });
      return;
    }
    const tiffName = req.file
      ? `/uploads/${req.file.filename}`
      : String((req.body as { filename?: string }).filename ?? '').trim() || `cetak-item-${item.id}.tif`;

    item.file_cetak_tiff = tiffName;
    item.updated_at = new Date().toISOString();
    store.persist();
    broadcastEvent('design_updated', { orderId: item.order_id });
    const order = db.orders.find((o) => o.id === item.order_id)!;
    res.json({ order: store.hydrateOrder(order) });
  });

  app.post('/api/desainer/orders/:id/master', requireAuth(['desainer']), upload.single('file_master_arsip'), (req, res) => {
    const desainer = getCurrentUser(req);
    const db = store.getState();
    const order = db.orders.find((o) => o.id === Number(req.params.id));
    if (!order) {
      res.status(404).json({ error: 'Nota tidak ditemukan.' });
      return;
    }
    const items = db.order_items.filter((i) => i.order_id === order.id);
    if (items.length === 0 || !items.every((i) => Boolean(i.file_cetak_tiff))) {
      res.status(422).json({ error: 'Seluruh item dalam nota wajib memiliki file cetak .TIFF sebelum finalisasi master.' });
      return;
    }
    const masterFile = req.file
      ? `/uploads/${req.file.filename}`
      : String((req.body as { filename?: string }).filename ?? '').trim() || `MASTER-${order.no_nota}.cdr`;
    const ttd = String((req.body as { tanda_tangan?: string }).tanda_tangan ?? '').trim() || desainer.name;
    const now = new Date().toISOString();

    order.file_master_arsip = masterFile;
    order.tanda_tangan_desainer = ttd;
    order.waktu_selesai_desain = now;
    order.status_desain = 'siap_cetak_tiff';
    order.updated_at = now;

    for (const item of items) {
      item.file_master_arsip = masterFile;
      item.status_produksi = 'antrean_cetak';
      item.updated_at = now;
    }
    store.persist();
    broadcastEvent('production_updated', { orderId: order.id });
    res.json({ order: store.hydrateOrder(order) });
  });

  // --- OPERATOR CETAK WORKFLOW ---
  app.get('/api/operator/queue', requireAuth(['operator_cetak']), (_req, res) => {
    const db = store.getState();
    const items = db.order_items
      .filter((i) => i.status_produksi === 'antrean_cetak' || i.status_produksi === 'proses_cetak')
      .filter((i) => {
        const order = db.orders.find((o) => o.id === i.order_id);
        return order ? activeOrderRaw(order) : false;
      })
      .map((i) => {
        const order = db.orders.find((o) => o.id === i.order_id);
        const customer = order ? db.customers.find((c) => c.id === order.customer_id) : null;
        return {
          ...store.hydrateItem(i),
          no_nota: order?.no_nota ?? '-',
          instansi: customer?.instansi ?? 'Perorangan',
          nama_pelanggan: customer?.nama_pelanggan ?? '-',
          deadline: order?.deadline ?? null,
        };
      });
    res.json({
      items,
      rolls: db.material_rolls.filter((r) => r.status === 'aktif'),
      offcuts: db.material_offcuts.filter((o) => o.status === 'tersedia'),
      machines: db.machines.filter((m) => m.aktif),
      supplies: db.supplies.filter((s) => s.aktif),
      batches: db.print_batches.slice(-20).reverse(),
    });
  });

  app.post('/api/operator/items/:id/mulai', requireAuth(['operator_cetak']), (req, res) => {
    const operator = getCurrentUser(req);
    const db = store.getState();
    const item = db.order_items.find((i) => i.id === Number(req.params.id));
    if (!item || item.status_produksi !== 'antrean_cetak') {
      res.status(403).json({ error: 'Item tidak berada pada status Antrean Cetak.' });
      return;
    }
    const product = db.products.find((p) => p.id === item.product_id);
    const machineId = Number((req.body as { machine_id?: number }).machine_id ?? item.machine_id ?? product?.mesin_default_id ?? 0);
    const machine = db.machines.find((m) => m.id === machineId && m.aktif);
    if (!machine) {
      res.status(422).json({ error: 'Pilih mesin cetak aktif yang akan dipakai.' });
      return;
    }
    const now = new Date().toISOString();
    item.status_produksi = 'proses_cetak';
    item.machine_id = machine.id;
    item.operator_id = operator.id;
    item.waktu_mulai_cetak = item.waktu_mulai_cetak ?? now;
    item.updated_at = now;
    store.persist();
    broadcastEvent('production_updated', { orderId: item.order_id });
    res.json({ item: store.hydrateItem(item) });
  });

  app.post('/api/operator/items/:id/selesai', requireAuth(['operator_cetak']), (req, res) => {
    const db = store.getState();
    const item = db.order_items.find((i) => i.id === Number(req.params.id));
    if (!item || !['antrean_cetak', 'proses_cetak'].includes(item.status_produksi)) {
      res.status(403).json({ error: 'Item tidak berada di antrean cetak.' });
      return;
    }
    const parentOrder = db.orders.find((o) => o.id === item.order_id);
    if (!parentOrder || !activeOrderRaw(parentOrder)) {
      res.status(422).json({ error: 'Nota sudah dibatalkan (void). Produksi tidak dapat dilanjutkan.' });
      return;
    }

    const product = db.products.find((p) => p.id === item.product_id);
    if (!product) {
      res.status(404).json({ error: 'Produk tidak ditemukan.' });
      return;
    }

    const {
      sumber_bahan,
      material_roll_id,
      material_offcut_id,
      orientasi_potong,
      machine_id,
    } = req.body as {
      sumber_bahan?: 'roll' | 'offcut';
      material_roll_id?: number;
      material_offcut_id?: number;
      orientasi_potong?: 'panjang' | 'lebar';
      machine_id?: number;
    };

    const machineId = Number(machine_id ?? item.machine_id ?? product.mesin_default_id ?? 0);
    const machine = db.machines.find((m) => m.id === machineId && m.aktif) ?? null;
    if (!machine) {
      res.status(422).json({ error: 'Mesin cetak aktif belum ditentukan untuk item ini.' });
      return;
    }

    const now = new Date().toISOString();
    let luasCetakM2 = 0;
    if (product.kategori_produk === 'meteran') {
      const finishing = item.finishing_id
        ? db.finishings.find((f) => f.id === item.finishing_id) ?? null
        : null;
      const ukuranKotor = computeUkuranKotor(item.lebar_m ?? 0, item.tinggi_m ?? 0, item.qty, finishing);
      const orientasi = orientasi_potong === 'lebar' ? 'lebar' : 'panjang';
      const panjangPakai = round2(orientasi === 'lebar' ? ukuranKotor.lebar * item.qty : ukuranKotor.tinggi * item.qty);
      const lebarPakai = round2(orientasi === 'lebar' ? ukuranKotor.tinggi : ukuranKotor.lebar);
      const luasNetto = round2((item.lebar_m ?? 0) * (item.tinggi_m ?? 0) * item.qty);
      luasCetakM2 = luasNetto;
      const wosFinishing = round2(Math.max(ukuranKotor.luas - luasNetto, 0));
      let wosPotong = 0;
      let rollId: number | null = null;
      let offcutId: number | null = null;

      if (sumber_bahan === 'offcut') {
        const offcut = db.material_offcuts.find((o) => o.id === Number(material_offcut_id));
        if (!offcut || offcut.status !== 'tersedia') {
          res.status(422).json({ error: 'Stok potongan (offcut) tidak tersedia.' });
          return;
        }
        if (offcut.lebar_m + 0.001 < lebarPakai) {
          res.status(422).json({ error: `Lebar potongan (${offcut.lebar_m} m) kurang dari kebutuhan (${lebarPakai} m).` });
          return;
        }
        if (offcut.panjang_m + 0.001 < panjangPakai) {
          res.status(422).json({ error: `Panjang potongan (${offcut.panjang_m} m) kurang dari kebutuhan (${panjangPakai} m).` });
          return;
        }
        offcut.status = 'terpakai';
        offcutId = offcut.id;
      } else {
        const roll = db.material_rolls.find((r) => r.id === Number(material_roll_id));
        if (!roll || roll.status !== 'aktif') {
          res.status(422).json({ error: 'Roll bahan aktif wajib dipilih.' });
          return;
        }
        if (roll.lebar_m + 0.001 < lebarPakai) {
          res.status(422).json({ error: `Lebar roll (${roll.lebar_m} m) kurang dari lebar kotor (${lebarPakai} m).` });
          return;
        }
        if (roll.panjang_sisa_m + 0.001 < panjangPakai) {
          res.status(422).json({ error: `Sisa panjang roll (${roll.panjang_sisa_m} m) tidak mencukupi (${panjangPakai} m).` });
          return;
        }
        const sisaRoll = round2(roll.panjang_sisa_m - panjangPakai);
        roll.panjang_sisa_m = sisaRoll;
        roll.status = sisaRoll <= 0 ? 'habis' : 'aktif';
        rollId = roll.id;

        const sisaLebar = round2(roll.lebar_m - lebarPakai);
        if (sisaLebar >= 0.5) {
          db.material_offcuts.push({
            id: store.nextId('material_offcuts'),
            material_roll_id: roll.id,
            kode_roll: roll.kode_roll,
            jenis_bahan: roll.jenis_bahan,
            lebar_m: sisaLebar,
            panjang_m: panjangPakai,
            luas_m2: round2(sisaLebar * panjangPakai),
            status: 'tersedia',
            created_at: now,
          });
        } else {
          wosPotong = round2(Math.max(sisaLebar, 0) * panjangPakai);
        }
      }

      db.material_logs.push({
        id: store.nextId('material_logs'),
        order_item_id: item.id,
        material_roll_id: rollId,
        material_offcut_id: offcutId,
        luas_netto_m2: luasNetto,
        wos_finishing_m2: wosFinishing,
        wos_potong_m2: wosPotong,
        gagal_cetak_m2: 0,
        keterangan: `Selesai cetak | ${product.nama_produk} | ${panjangPakai} m`,
        created_at: now,
      });
    } else {
      if (product.stok_pcs !== null) {
        if (product.stok_pcs < item.qty) {
          res.status(422).json({ error: `Stok produk satuan ${product.nama_produk} tidak mencukupi.` });
          return;
        }
        product.stok_pcs -= item.qty;
      }
      if ((product.satuan_hitung ?? 'pcs') === 'klik') {
        luasCetakM2 = round2(item.qty * A3_PLUS_AREA_M2);
      }
    }

    const klikTotal =
      (product.satuan_hitung ?? 'pcs') === 'klik'
        ? item.qty * (product.klik_per_lembar ?? 1)
        : null;
    const estimasiTinta = round2(luasCetakM2 * (machine.konsumsi_tinta_ml_per_m2 ?? 0));
    let peringatanStok: string | null = null;
    if (estimasiTinta > 0) {
      const ink = selectInkSupply(db, machine);
      if (!ink) {
        peringatanStok = 'Stok tinta tidak tersedia; estimasi tetap dicatat.';
      } else {
        const pakai = round2(Math.min(ink.stok, estimasiTinta));
        ink.stok = round2(ink.stok - pakai);
        ink.updated_at = now;
        db.supply_usages.push({
          id: store.nextId('supply_usages'),
          supply_id: ink.id,
          order_item_id: item.id,
          jumlah: pakai,
          satuan: ink.satuan,
          keterangan: `Estimasi tinta cetak | ${product.nama_produk} | ${machine.nama_mesin}`,
          user_id: getCurrentUser(req).id,
          created_at: now,
        });
        if (pakai + 0.001 < estimasiTinta) {
          peringatanStok = `Stok ${ink.nama} hanya ${ink.stok.toLocaleString('id-ID')} ${ink.satuan}; pemakaian dibatasi.`;
        }
      }
    }

    item.machine_id = machine.id;
    item.operator_id = getCurrentUser(req).id;
    item.klik_total = klikTotal;
    item.estimasi_tinta_ml = estimasiTinta;
    item.waktu_mulai_cetak = item.waktu_mulai_cetak ?? now;
    item.waktu_selesai_cetak = now;
    item.status_produksi = item.finishing_id ? 'antrean_finishing' : 'siap_diambil';
    item.updated_at = now;
    store.persist();
    broadcastEvent('production_updated', { orderId: item.order_id });
    enqueueSiapDiambil(item.order_id);
    res.json({ item: store.hydrateItem(item), estimasi_tinta_ml: estimasiTinta, klik_total: klikTotal, peringatan_stok: peringatanStok });
  });

  app.post('/api/operator/items/:id/gagal-cetak', requireAuth(['operator_cetak']), (req, res) => {
    const db = store.getState();
    const item = db.order_items.find((i) => i.id === Number(req.params.id));
    if (!item || !['antrean_cetak', 'proses_cetak'].includes(item.status_produksi)) {
      res.status(403).json({ error: 'Item tidak berada di antrean cetak.' });
      return;
    }
    const { material_roll_id, panjang_rusak_m, alasan } = req.body as {
      material_roll_id?: number;
      panjang_rusak_m?: number;
      alasan?: string;
    };
    const roll = db.material_rolls.find((r) => r.id === Number(material_roll_id));
    if (!roll || roll.status !== 'aktif') {
      res.status(422).json({ error: 'Pilih roll aktif yang mengalami gagal cetak.' });
      return;
    }
    const panjangRusak = round2(Number(panjang_rusak_m ?? 0));
    if (!(panjangRusak > 0)) {
      res.status(422).json({ error: 'Panjang bahan rusak wajib lebih dari 0 meter.' });
      return;
    }
    if (roll.panjang_sisa_m + 0.001 < panjangRusak) {
      res.status(422).json({ error: 'Panjang rusak melebihi sisa roll aktif.' });
      return;
    }
    const sisa = round2(roll.panjang_sisa_m - panjangRusak);
    roll.panjang_sisa_m = sisa;
    roll.status = sisa <= 0 ? 'habis' : 'aktif';
    const luasRusak = round2(roll.lebar_m * panjangRusak);

    db.material_logs.push({
      id: store.nextId('material_logs'),
      order_item_id: item.id,
      material_roll_id: roll.id,
      material_offcut_id: null,
      luas_netto_m2: 0,
      wos_finishing_m2: 0,
      wos_potong_m2: 0,
      gagal_cetak_m2: luasRusak,
      keterangan: `Gagal cetak | Roll ${roll.kode_roll} | ${panjangRusak} m${alasan ? ` (${alasan})` : ''}`,
      created_at: new Date().toISOString(),
    });
    store.persist();
    broadcastEvent('stock_updated', { orderId: item.order_id });
    res.json({ message: 'Gagal cetak dicatat ke audit bahan tanpa mengubah tagihan pelanggan.' });
  });

  // --- OPERATOR: BATCH NESTING MULTI-ORDER ---
  app.get('/api/operator/batches', requireAuth(['operator_cetak', 'owner']), (_req, res) => {
    const db = store.getState();
    const batches = [...db.print_batches].reverse().map((b) => ({
      ...b,
      machine_name: db.machines.find((m) => m.id === b.machine_id)?.nama_mesin ?? null,
      operator_name: db.users.find((u) => u.id === b.operator_id)?.name ?? null,
    }));
    res.json({ batches });
  });

  app.post('/api/operator/batch-nesting', requireAuth(['operator_cetak']), (req, res) => {
    const operator = getCurrentUser(req);
    const db = store.getState();
    const body = req.body as {
      item_ids?: number[];
      machine_id?: number;
      material_roll_id?: number;
      catatan?: string;
    };
    const ids = (body.item_ids ?? [])
      .map(Number)
      .filter((n) => Number.isFinite(n));
    if (ids.length < 2 || ids.length > 4) {
      res.status(422).json({ error: 'Batch nesting memerlukan 2–4 item yang dicentang.' });
      return;
    }
    const items = ids
      .map((id) => db.order_items.find((i) => i.id === id))
      .filter((i): i is (typeof db.order_items)[number] => Boolean(i));
    if (items.length !== ids.length) {
      res.status(404).json({ error: 'Sebagian item batch tidak ditemukan.' });
      return;
    }
    const hydrated = items.map((i) => store.hydrateItem(i));
    if (
      items.some((i) => !['antrean_cetak', 'proses_cetak'].includes(i.status_produksi)) ||
      items.some((i) => {
        const order = db.orders.find((o) => o.id === i.order_id);
        return !order || !activeOrderRaw(order);
      }) ||
      hydrated.some((i) => !i.ukuran_kotor || i.product_id !== items[0].product_id)
    ) {
      res.status(422).json({
        error: 'Semua item harus aktif, berstatus antrean/proses cetak, bertipe meteran, dan memakai bahan produk yang sama.',
      });
      return;
    }

    const machine = db.machines.find(
      (m) => m.id === Number(body.machine_id ?? items[0].machine_id ?? 0) && m.aktif,
    );
    if (!machine) {
      res.status(422).json({ error: 'Mesin cetak aktif wajib dipilih untuk batch nesting.' });
      return;
    }
    const roll = body.material_roll_id
      ? db.material_rolls.find((r) => r.id === Number(body.material_roll_id) && r.status === 'aktif') ?? null
      : null;
    if (body.material_roll_id && !roll) {
      res.status(422).json({ error: 'Roll bahan aktif tidak ditemukan.' });
      return;
    }

    const stats = computeBatchNesting(hydrated, roll?.lebar_m ?? null);
    if (roll && stats.lebar_gabungan_m > roll.lebar_m + 0.001) {
      res.status(422).json({
        error: `Lebar gabungan ${stats.lebar_gabungan_m} m melebihi lebar roll ${roll.lebar_m} m.`,
      });
      return;
    }
    if (roll && stats.panjang_tarik_m > roll.panjang_sisa_m + 0.001) {
      res.status(422).json({
        error: `Sisa roll ${roll.panjang_sisa_m} m tidak cukup untuk tarikan ${stats.panjang_tarik_m} m.`,
      });
      return;
    }

    const batch: PrintBatch = {
      id: store.nextId('print_batches'),
      kode_batch: `BN-${Date.now().toString(36).toUpperCase()}`,
      machine_id: machine.id,
      operator_id: operator.id,
      item_ids: ids,
      lebar_gabungan_m: stats.lebar_gabungan_m,
      panjang_tarik_m: stats.panjang_tarik_m,
      luas_terpakai_m2: stats.luas_terpakai_m2,
      luas_waste_m2: stats.luas_waste_m2,
      status: 'dihitung',
      catatan: body.catatan?.trim() || null,
      created_at: new Date().toISOString(),
    };
    db.print_batches.push(batch);
    auditRequest(req, 'batch_nesting_created', 'batch', batch.id, `Batch ${batch.kode_batch}: ${ids.length} item, lebar ${stats.lebar_gabungan_m} m.`);
    store.persist();
    broadcastEvent('production_updated', { orderId: items[0].order_id });
    res.status(201).json({
      batch: { ...batch, machine_name: machine.nama_mesin, operator_name: operator.name },
      stats,
      items: items.map((i) => ({
        id: i.id,
        no_nota: db.orders.find((o) => o.id === i.order_id)?.no_nota ?? '-',
      })),
    });
  });

  app.post('/api/operator/batches/:id/proses', requireAuth(['operator_cetak']), (req, res) => {
    const operator = getCurrentUser(req);
    const db = store.getState();
    const batch = db.print_batches.find((b) => b.id === Number(req.params.id));
    if (!batch) {
      res.status(404).json({ error: 'Batch nesting tidak ditemukan.' });
      return;
    }
    if (batch.status === 'diproses') {
      res.status(422).json({ error: 'Batch ini sudah diproses.' });
      return;
    }
    const now = new Date().toISOString();
    let touchedOrderId = 0;
    for (const itemId of batch.item_ids) {
      const item = db.order_items.find((i) => i.id === itemId);
      if (!item || !['antrean_cetak', 'proses_cetak'].includes(item.status_produksi)) continue;
      item.status_produksi = 'proses_cetak';
      item.machine_id = batch.machine_id;
      item.operator_id = operator.id;
      item.batch_id = batch.id;
      item.waktu_mulai_cetak = item.waktu_mulai_cetak ?? now;
      item.updated_at = now;
      touchedOrderId = item.order_id;
    }
    batch.status = 'diproses';
    auditRequest(req, 'batch_nesting_proses', 'batch', batch.id, `Batch ${batch.kode_batch} mulai diproses di mesin #${batch.machine_id}.`);
    store.persist();
    broadcastEvent('production_updated', { orderId: touchedOrderId });
    res.json({ batch });
  });

  // --- FINISHING WORKFLOW ---
  app.get('/api/finishing/queue', requireAuth(['finishing']), (_req, res) => {
    const db = store.getState();
    const items = db.order_items
      .filter((i) => i.status_produksi === 'antrean_finishing' || i.status_produksi === 'proses_finishing')
      .filter((i) => {
        const order = db.orders.find((o) => o.id === i.order_id);
        return order ? activeOrderRaw(order) : false;
      })
      .map((i) => {
        const order = db.orders.find((o) => o.id === i.order_id);
        const customer = order ? db.customers.find((c) => c.id === order.customer_id) : null;
        return {
          ...store.hydrateItem(i),
          no_nota: order?.no_nota ?? '-',
          instansi: customer?.instansi ?? 'Perorangan',
          nama_pelanggan: customer?.nama_pelanggan ?? '-',
          deadline: order?.deadline ?? null,
        };
      });
    res.json({ items });
  });

  app.post('/api/finishing/items/:id/konfirmasi', requireAuth(['finishing']), (req, res) => {
    const user = getCurrentUser(req);
    const db = store.getState();
    const item = db.order_items.find((i) => i.id === Number(req.params.id));
    if (!item || !['antrean_finishing', 'proses_finishing'].includes(item.status_produksi)) {
      res.status(403).json({ error: 'Item tidak berada di antrean finishing.' });
      return;
    }
    const { bahan_pembantu } = (req.body ?? {}) as {
      bahan_pembantu?: Array<{ supply_id?: number; jumlah?: number }>;
    };
    const usages: SupplyUsage[] = [];
    const now = new Date().toISOString();
    for (const row of bahan_pembantu ?? []) {
      const supply = db.supplies.find(
        (s) => s.id === Number(row.supply_id) && s.aktif && s.kategori === 'bahan_pembantu',
      );
      if (!supply) {
        res.status(422).json({ error: 'Bahan pembantu tidak tersedia atau bukan kategori finishing.' });
        return;
      }
      const jumlah = round2(Number(row.jumlah ?? 0));
      if (!(jumlah > 0) || supply.stok + 0.001 < jumlah) {
        res.status(422).json({ error: `Stok ${supply.nama} tidak mencukupi (${supply.stok} ${supply.satuan}).` });
        return;
      }
      supply.stok = round2(supply.stok - jumlah);
      supply.updated_at = now;
      usages.push({
        id: store.nextId('supply_usages'),
        supply_id: supply.id,
        order_item_id: item.id,
        jumlah,
        satuan: supply.satuan,
        keterangan: `Finishing | ${supply.nama}`,
        user_id: user.id,
        created_at: now,
      });
    }
    db.supply_usages.push(...usages);
    item.finishing_user_id = user.id;
    item.status_produksi = 'siap_diambil';
    item.updated_at = now;
    auditRequest(req, 'finishing_done', 'order_item', item.id, `Finishing diselesaikan oleh ${user.name}${usages.length ? ` dengan ${usages.length} bahan pembantu` : ''}.`);
    store.persist();
    broadcastEvent('production_updated', { orderId: item.order_id });
    enqueueSiapDiambil(item.order_id);
    res.json({ item: store.hydrateItem(item), bahan_pembantu: usages.map((u) => ({ ...u, supply_name: db.supplies.find((s) => s.id === u.supply_id)?.nama ?? null })) });
  });

  // --- ADVERTISING WORKFLOW (STRICTLY NON-BILLING) ---
  app.get('/api/advertising/spks', requireAuth(['advertising', 'owner', 'admin']), (req, res) => {
    const db = store.getState();
    const statusFilter = String(req.query.status ?? '');
    let spks = db.advertising_spks.map((s) => {
      const order = db.orders.find((o) => o.id === s.order_id);
      const customer = order ? db.customers.find((c) => c.id === order.customer_id) : null;
      return {
        ...s,
        no_nota: order?.no_nota ?? '-',
        instansi: customer?.instansi ?? 'Perorangan',
        nama_pelanggan: customer?.nama_pelanggan ?? '-',
        deadline: order?.deadline ?? null,
      };
    });
    if (statusFilter) {
      spks = spks.filter((s) => s.status_lapangan === statusFilter);
    }
    spks.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    res.json({ spks });
  });

  app.post('/api/advertising/spks/:id/status', requireAuth(['advertising']), (req, res) => {
    const db = store.getState();
    const spk = db.advertising_spks.find((s) => s.id === Number(req.params.id));
    if (!spk) {
      res.status(404).json({ error: 'SPK tidak ditemukan.' });
      return;
    }
    const status = (req.body as { status_lapangan?: SpkFieldStatus }).status_lapangan;
    if (!status || !['antrean', 'perakitan', 'pemasangan', 'selesai'].includes(status)) {
      res.status(422).json({ error: 'Status lapangan SPK tidak valid.' });
      return;
    }
    spk.status_lapangan = status;
    spk.updated_at = new Date().toISOString();
    store.persist();
    broadcastEvent('spk_updated', { orderId: spk.order_id });
    res.json({ spk });
  });

  // --- SERAH TERIMA (SHARED ADMIN + DIVISIONS) ---
  app.get('/api/serah-terima', requireAuth(['admin', 'desainer', 'operator_cetak', 'finishing', 'advertising']), (req, res) => {
    const user = getCurrentUser(req);
    const q = String(req.query.q ?? '').trim().toLowerCase();
    const db = store.getState();
    let orders = db.orders
      .map((o) => store.hydrateOrder(o))
      .filter((o) => store.isOrderSiapDiambil(o));

    if (q) {
      orders = orders.filter(
        (o) =>
          o.no_nota.toLowerCase().includes(q) ||
          (o.customer?.instansi ?? '').toLowerCase().includes(q) ||
          (o.customer?.nama_pelanggan ?? '').toLowerCase().includes(q),
      );
    }
    if (user.role === 'advertising') {
      orders = orders.map((o) => ({
        ...o,
        total_tagihan: 0,
        jumlah_dp: 0,
        sisa_tagihan: 0,
        payments: [],
        items: o.items.map((i) => ({ ...i, harga_satuan_dipakai: 0, subtotal: 0 })),
      }));
    }
    res.json({ orders });
  });

  app.post(
    '/api/orders/:id/serah-terima',
    requireAuth(['admin', 'desainer', 'operator_cetak', 'finishing', 'advertising']),
    upload.single('foto_serah_terima'),
    (req, res) => {
      const db = store.getState();
      const order = db.orders.find((o) => o.id === Number(req.params.id));
      if (!order) {
        res.status(404).json({ error: 'Nota tidak ditemukan.' });
        return;
      }
      if (order.status_bayar !== 'lunas') {
        res.status(403).json({ error: 'Pelunasan wajib sebelum serah terima.' });
        return;
      }
      const hydrated = store.hydrateOrder(order);
      if (!store.isOrderSiapDiambil(hydrated)) {
        res.status(403).json({ error: 'Nota ini belum siap diambil atau sudah diserahkan.' });
        return;
      }

      const { nama_pengambil, no_wa_pengambil, catatan_pengecualian, tanda_tangan_pengambil } = req.body as {
        nama_pengambil?: string;
        no_wa_pengambil?: string;
        catatan_pengecualian?: string;
        tanda_tangan_pengambil?: string;
      };
      if (!nama_pengambil?.trim() || !no_wa_pengambil?.trim()) {
        res.status(422).json({ error: 'Nama pengambil dan No. WhatsApp pengambil wajib diisi.' });
        return;
      }
      let signature: string | null = null;
      if (typeof tanda_tangan_pengambil === 'string' && tanda_tangan_pengambil.trim()) {
        const value = tanda_tangan_pengambil.trim();
        if (!/^data:image\/(png|jpeg|jpg);base64,[A-Za-z0-9+/=\s]+$/.test(value) || value.length > 3_000_000) {
          res.status(422).json({ error: 'Tanda tangan pengambil harus berupa gambar PNG/JPG yang valid (maks. 2 MB).' });
          return;
        }
        signature = value;
      }

      const now = new Date().toISOString();
      order.nama_pengambil = nama_pengambil.trim();
      order.no_wa_pengambil = no_wa_pengambil.trim();
      order.waktu_serah_terima = now;
      order.tanda_tangan_pengambil = signature;
      if (req.file) {
        order.foto_serah_terima = `/uploads/${req.file.filename}`;
      }
      if (catatan_pengecualian?.trim()) {
        order.catatan_pengecualian = catatan_pengecualian.trim();
      }
      order.updated_at = now;

      for (const item of db.order_items) {
        if (item.order_id === order.id && item.status_produksi === 'siap_diambil') {
          item.status_produksi = 'selesai';
          item.updated_at = now;
        }
      }
      auditRequest(req, 'serah_terima', 'order', order.id, `Serah terima kepada ${nama_pengambil.trim()}${signature ? ' dengan tanda tangan digital' : ''}.`);
      store.persist();
      broadcastEvent('order_handed_over', { orderId: order.id });
      res.json({ order: store.hydrateOrder(order) });
    },
  );

  // --- RIWAYAT SELESAI PER DIVISI ---
  app.get('/api/riwayat/:divisi', requireAuth(), (req, res) => {
    const db = store.getState();
    const divisi = req.params.divisi;
    const q = String(req.query.q ?? '').trim().toLowerCase();
    let orders = db.orders.map((o) => store.hydrateOrder(o));

    if (divisi === 'desainer') {
      orders = orders.filter((o) => Boolean(o.file_master_arsip));
    } else if (divisi === 'operator') {
      orders = orders.filter((o) =>
        o.items.some((i) => ['antrean_finishing', 'proses_finishing', 'siap_diambil', 'selesai'].includes(i.status_produksi)),
      );
    } else if (divisi === 'finishing') {
      orders = orders.filter((o) =>
        o.items.some((i) => i.finishing_id !== null && ['siap_diambil', 'selesai'].includes(i.status_produksi)),
      );
    } else if (divisi === 'advertising') {
      orders = orders
        .filter((o) => o.advertising_spks.some((s) => s.status_lapangan === 'selesai'))
        .map((o) => ({
          ...o,
          total_tagihan: 0,
          jumlah_dp: 0,
          sisa_tagihan: 0,
          payments: [],
          items: o.items.map((i) => ({ ...i, harga_satuan_dipakai: 0, subtotal: 0 })),
        }));
    }

    if (q) {
      orders = orders.filter(
        (o) =>
          o.no_nota.toLowerCase().includes(q) ||
          (o.customer?.instansi ?? '').toLowerCase().includes(q) ||
          (o.customer?.nama_pelanggan ?? '').toLowerCase().includes(q),
      );
    }
    res.json({ orders });
  });

  // --- OWNER: MANAJEMEN STAF & AUDIT ---
  app.get('/api/owner/staff', requireAuth(['owner']), (_req, res) => {
    res.json({ staff: store.getState().users.map(sanitizeUser) });
  });

  app.post('/api/owner/staff', requireAuth(['owner']), (req, res) => {
    const actor = getCurrentUser(req);
    const body = req.body as {
      name?: string;
      email?: string;
      password?: string;
      role?: UserRole;
      active?: boolean;
    };
    const name = String(body.name ?? '').trim();
    const email = String(body.email ?? '').trim().toLowerCase();
    const password = String(body.password ?? '');
    const role = body.role;
    const validRoles: UserRole[] = ['admin', 'desainer', 'operator_cetak', 'finishing', 'advertising', 'owner'];
    if (!name || !email || !password || !role) {
      res.status(422).json({ error: 'Nama, email, kata sandi, dan peran wajib diisi.' });
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      res.status(422).json({ error: 'Format email tidak valid.' });
      return;
    }
    if (password.length < 6) {
      res.status(422).json({ error: 'Kata sandi minimal 6 karakter.' });
      return;
    }
    if (!validRoles.includes(role)) {
      res.status(422).json({ error: 'Peran staf tidak valid.' });
      return;
    }
    const db = store.getState();
    if (db.users.some((u) => u.email.toLowerCase() === email)) {
      res.status(422).json({ error: `Email ${email} sudah terdaftar.` });
      return;
    }
    const user: StoredUser = {
      id: store.nextId('users'),
      name,
      email,
      role,
      password: hashPassword(password),
      active: body.active !== false,
    };
    db.users.push(user);
    recordAudit(actor, 'staff_create', 'user', user.id, `Staf ${name} (${role}) ditambahkan`, clientIp(req));
    store.persist();
    res.status(201).json({ staff: sanitizeUser(user) });
  });

  app.put('/api/owner/staff/:id', requireAuth(['owner']), (req, res) => {
    const actor = getCurrentUser(req);
    const db = store.getState();
    const target = db.users.find((u) => u.id === Number(req.params.id));
    if (!target) {
      res.status(404).json({ error: 'Akun staf tidak ditemukan.' });
      return;
    }
    const body = req.body as {
      name?: string;
      email?: string;
      role?: UserRole;
      active?: boolean;
      password?: string;
    };
    const validRoles: UserRole[] = ['admin', 'desainer', 'operator_cetak', 'finishing', 'advertising', 'owner'];
    if (body.email !== undefined) {
      const email = body.email.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        res.status(422).json({ error: 'Format email tidak valid.' });
        return;
      }
      if (db.users.some((u) => u.id !== target.id && u.email.toLowerCase() === email)) {
        res.status(422).json({ error: `Email ${email} sudah digunakan staf lain.` });
        return;
      }
      target.email = email;
    }
    if (body.name !== undefined) {
      const name = body.name.trim();
      if (!name) {
        res.status(422).json({ error: 'Nama staf tidak boleh kosong.' });
        return;
      }
      target.name = name;
    }
    if (body.role !== undefined) {
      if (!validRoles.includes(body.role)) {
        res.status(422).json({ error: 'Peran staf tidak valid.' });
        return;
      }
      target.role = body.role;
    }
    if (body.active !== undefined) {
      if (target.id === actor.id && body.active === false) {
        res.status(422).json({ error: 'Anda tidak dapat menonaktifkan akun sendiri.' });
        return;
      }
      if (target.role === 'owner' && body.active === false) {
        const ownerAktif = db.users.filter((u) => u.role === 'owner' && u.active !== false);
        if (ownerAktif.length <= 1) {
          res.status(422).json({ error: 'Minimal harus ada satu akun Owner yang aktif.' });
          return;
        }
      }
      target.active = Boolean(body.active);
    }
    if (body.password) {
      if (body.password.length < 6) {
        res.status(422).json({ error: 'Kata sandi minimal 6 karakter.' });
        return;
      }
      target.password = hashPassword(body.password);
    }
    recordAudit(actor, 'staff_update', 'user', target.id, `Akun ${target.name} diperbarui`, clientIp(req));
    store.persist();
    res.json({ staff: sanitizeUser(target) });
  });

  app.delete('/api/owner/staff/:id', requireAuth(['owner']), (req, res) => {
    const actor = getCurrentUser(req);
    const db = store.getState();
    const target = db.users.find((u) => u.id === Number(req.params.id));
    if (!target) {
      res.status(404).json({ error: 'Akun staf tidak ditemukan.' });
      return;
    }
    if (target.id === actor.id) {
      res.status(422).json({ error: 'Anda tidak dapat menghapus akun sendiri.' });
      return;
    }
    if (target.role === 'owner') {
      const ownerAktif = db.users.filter((u) => u.role === 'owner' && u.active !== false);
      if (ownerAktif.length <= 1) {
        res.status(422).json({ error: 'Minimal harus ada satu akun Owner yang aktif.' });
        return;
      }
    }
    target.active = false;
    recordAudit(actor, 'staff_deactivate', 'user', target.id, `Akun ${target.name} dinonaktifkan`, clientIp(req));
    store.persist();
    res.json({ staff: sanitizeUser(target), deactivated: true });
  });

  app.get('/api/owner/audit-logs', requireAuth(['owner']), (req, res) => {
    const db = store.getState();
    const action = String(req.query.action ?? '').trim();
    const entity = String(req.query.entity ?? '').trim();
    const dari = req.query.dari ? String(req.query.dari) : null;
    const sampai = req.query.sampai ? String(req.query.sampai) : null;
    const limit = Math.min(Math.max(Number(req.query.limit ?? 200), 1), 1000);
    let logs = [...db.audit_logs];
    if (action) logs = logs.filter((l) => l.action === action);
    if (entity) logs = logs.filter((l) => l.entity === entity);
    if (dari) logs = logs.filter((l) => l.created_at.slice(0, 10) >= dari);
    if (sampai) logs = logs.filter((l) => l.created_at.slice(0, 10) <= sampai);
    logs.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    res.json({ logs: logs.slice(0, limit), total: logs.length });
  });

  // --- OWNER: LAPORAN KEUANGAN (CASHFLOW, AGING, MARGIN, KOMISI) ---
  app.get('/api/owner/reports/finance', requireAuth(['owner']), (req, res) => {
    const db = store.getState();
    const dari = req.query.dari ? String(req.query.dari) : null;
    const sampai = req.query.sampai ? String(req.query.sampai) : null;
    const inRange = (iso: string) =>
      (!dari || iso.slice(0, 10) >= dari) && (!sampai || iso.slice(0, 10) <= sampai);

    const allOrders = db.orders.map((o) => store.hydrateOrder(o));
    const activeOrders = allOrders.filter((o) => activeOrderRaw(o));
    const rangeOrders = activeOrders.filter((o) => inRange(o.created_at));
    const activeOrderIds = new Set(activeOrders.map((o) => o.id));
    const rangeOrderIds = new Set(rangeOrders.map((o) => o.id));

    const payments = db.order_payments.filter(
      (p) => activeOrderIds.has(p.order_id) && inRange(p.created_at),
    );
    const sumBy = (metode: PaymentMethod) =>
      round2(payments.filter((p) => p.metode === metode).reduce((s, p) => s + p.nominal, 0));
    const cashflow = {
      tunai: sumBy('Tunai'),
      transfer: sumBy('Transfer'),
      qris: sumBy('QRIS'),
      total: round2(payments.reduce((s, p) => s + p.nominal, 0)),
      jumlah_transaksi: payments.length,
    };
    const dailyMap = new Map<string, { tanggal: string; tunai: number; transfer: number; qris: number; total: number }>();
    for (const p of payments) {
      const key = p.created_at.slice(0, 10);
      if (!dailyMap.has(key)) {
        dailyMap.set(key, { tanggal: key, tunai: 0, transfer: 0, qris: 0, total: 0 });
      }
      const row = dailyMap.get(key)!;
      if (p.metode === 'Tunai') row.tunai = round2(row.tunai + p.nominal);
      if (p.metode === 'Transfer') row.transfer = round2(row.transfer + p.nominal);
      if (p.metode === 'QRIS') row.qris = round2(row.qris + p.nominal);
      row.total = round2(row.total + p.nominal);
    }
    const cashflowHarian = Array.from(dailyMap.values()).sort((a, b) => a.tanggal.localeCompare(b.tanggal));

    const today = new Date();
    const piutang = activeOrders
      .filter((o) => o.sisa_tagihan > 0)
      .map((o) => {
        const due = o.jatuh_tempo ? new Date(o.jatuh_tempo) : new Date(new Date(o.created_at).getTime() + 30 * 86400_000);
        const umurHari = Math.floor((today.getTime() - due.getTime()) / 86400_000);
        const bucket = umurHari <= 0 ? 'lancar' : umurHari <= 30 ? '1-30' : umurHari <= 60 ? '31-60' : umurHari <= 90 ? '61-90' : '>90';
        return {
          order_id: o.id,
          no_nota: o.no_nota,
          instansi: o.customer?.instansi ?? 'Perorangan',
          nama_pelanggan: o.customer?.nama_pelanggan ?? '-',
          total_tagihan: o.total_tagihan,
          dibayar: o.jumlah_dp,
          sisa_tagihan: o.sisa_tagihan,
          jatuh_tempo: o.jatuh_tempo,
          umur_hari: umurHari,
          bucket,
        };
      })
      .sort((a, b) => b.umur_hari - a.umur_hari);
    const aging = {
      lancar: round2(piutang.filter((p) => p.bucket === 'lancar').reduce((s, p) => s + p.sisa_tagihan, 0)),
      '1-30': round2(piutang.filter((p) => p.bucket === '1-30').reduce((s, p) => s + p.sisa_tagihan, 0)),
      '31-60': round2(piutang.filter((p) => p.bucket === '31-60').reduce((s, p) => s + p.sisa_tagihan, 0)),
      '61-90': round2(piutang.filter((p) => p.bucket === '61-90').reduce((s, p) => s + p.sisa_tagihan, 0)),
      '>90': round2(piutang.filter((p) => p.bucket === '>90').reduce((s, p) => s + p.sisa_tagihan, 0)),
      total: round2(piutang.reduce((s, p) => s + p.sisa_tagihan, 0)),
    };

    const marginMap = new Map<string, { product_id: number; product_name: string; qty: number; omzet: number; hpp: number; margin: number; margin_persen: number }>();
    for (const item of db.order_items) {
      if (!rangeOrderIds.has(item.order_id)) continue;
      const product = db.products.find((p) => p.id === item.product_id);
      if (!product) continue;
      const key = String(product.id);
      if (!marginMap.has(key)) {
        marginMap.set(key, { product_id: product.id, product_name: product.nama_produk, qty: 0, omzet: 0, hpp: 0, margin: 0, margin_persen: 0 });
      }
      const row = marginMap.get(key)!;
      const qtyBasis = product.kategori_produk === 'meteran' ? item.luas_tagihan_m2 ?? 0 : item.qty;
      row.qty = round2(row.qty + qtyBasis);
      row.omzet = round2(row.omzet + item.subtotal);
      row.hpp = round2(row.hpp + qtyBasis * product.harga_modal);
    }
    const margins = Array.from(marginMap.values())
      .map((row) => ({
        ...row,
        margin: round2(row.omzet - row.hpp),
        margin_persen: row.omzet > 0 ? round2(((row.omzet - row.hpp) / row.omzet) * 100) : 0,
      }))
      .sort((a, b) => b.margin - a.margin);

    const komisiPersen = Math.max(0, Number(process.env.KOMISI_PERSEN ?? 1));
    const commissionMap = new Map<number, { user_id: number; user_name: string; role: string; jumlah_nota: number; omzet: number; komisi: number }>();
    for (const o of rangeOrders) {
      const user = db.users.find((u) => u.id === o.user_id);
      if (!commissionMap.has(o.user_id)) {
        commissionMap.set(o.user_id, {
          user_id: o.user_id,
          user_name: user?.name ?? o.admin_name ?? 'Admin',
          role: user?.role ?? 'admin',
          jumlah_nota: 0,
          omzet: 0,
          komisi: 0,
        });
      }
      const row = commissionMap.get(o.user_id)!;
      row.jumlah_nota += 1;
      row.omzet = round2(row.omzet + o.total_tagihan);
    }
    const komisi = Array.from(commissionMap.values())
      .map((row) => ({ ...row, komisi: round2((row.omzet * komisiPersen) / 100) }))
      .sort((a, b) => b.komisi - a.komisi);

    const expenses = db.operational_expenses.filter((e) => (!dari || e.tanggal >= dari) && (!sampai || e.tanggal <= sampai));
    const omzet = round2(rangeOrders.reduce((s, o) => s + o.total_tagihan, 0));
    const hpp = round2(margins.reduce((s, m) => s + m.hpp, 0));
    const totalOperasional = round2(expenses.reduce((s, e) => s + e.nominal, 0));

    res.json({
      dari,
      sampai,
      ringkasan: {
        omzet,
        jumlah_nota: rangeOrders.length,
        cash_masuk: cashflow.total,
        piutang: aging.total,
        hpp,
        laba_kotor: round2(omzet - hpp),
        total_operasional: totalOperasional,
        laba_bersih: round2(omzet - hpp - totalOperasional),
        komisi_persen: komisiPersen,
      },
      cashflow,
      cashflow_harian: cashflowHarian,
      aging,
      piutang,
      hutang: {
        total: round2(
          db.purchase_orders
            .filter((po) => po.status === 'diterima')
            .reduce((s, po) => s + Math.max(0, round2(po.total - (po.sudah_dibayar ?? 0))), 0),
        ),
        items: db.purchase_orders
          .filter((po) => po.status === 'diterima' && round2(po.total - (po.sudah_dibayar ?? 0)) > 0)
          .map((po) => {
            const due = po.expected_at ? new Date(po.expected_at) : new Date(new Date(po.tanggal).getTime() + 30 * 86400_000);
            const umurHari = Math.floor((today.getTime() - due.getTime()) / 86400_000);
            return {
              purchase_order_id: po.id,
              no_po: po.no_po,
              supplier: db.suppliers.find((s) => s.id === po.supplier_id)?.nama_supplier ?? '-',
              total: po.total,
              dibayar: po.sudah_dibayar ?? 0,
              sisa: round2(po.total - (po.sudah_dibayar ?? 0)),
              jatuh_tempo: po.expected_at,
              umur_hari: umurHari,
            };
          })
          .sort((a, b) => b.umur_hari - a.umur_hari),
        catatan: 'Hutang dagang dari Purchase Order yang sudah diterima dan belum lunas.',
      },
      margins,
      komisi,
    });
  });

  app.get('/api/owner/reports/export', requireAuth(['owner']), (req, res) => {
    const db = store.getState();
    const type = String(req.query.type ?? 'orders');
    const dari = req.query.dari ? String(req.query.dari) : null;
    const sampai = req.query.sampai ? String(req.query.sampai) : null;
    const inRange = (iso: string) =>
      (!dari || iso.slice(0, 10) >= dari) && (!sampai || iso.slice(0, 10) <= sampai);
    const orders = db.orders
      .map((o) => store.hydrateOrder(o))
      .filter((o) => activeOrderRaw(o) && inRange(o.created_at));

    let csv = '';
    let filename = 'reffo-export.csv';
    if (type === 'payments') {
      const ids = new Set(orders.map((o) => o.id));
      const payments = db.order_payments.filter((p) => ids.has(p.order_id) && inRange(p.created_at));
      csv = toCsv(
        ['Tanggal', 'No Nota', 'Metode', 'Nominal', 'Keterangan', 'Admin', 'Shift ID'],
        payments.map((p) => {
          const order = orders.find((o) => o.id === p.order_id);
          return [
            p.tanggal,
            order?.no_nota ?? '-',
            p.metode,
            p.nominal,
            p.keterangan ?? '',
            db.users.find((u) => u.id === p.admin_id)?.name ?? 'Admin',
            p.shift_id ?? '',
          ];
        }),
      );
      filename = `reffo-pembayaran-${dari ?? 'awal'}-${sampai ?? 'akhir'}.csv`;
    } else if (type === 'piutang') {
      csv = toCsv(
        ['No Nota', 'Instansi', 'Pelanggan', 'Total', 'Dibayar', 'Sisa', 'Jatuh Tempo', 'Status'],
        orders
          .filter((o) => o.sisa_tagihan > 0)
          .map((o) => [
            o.no_nota,
            o.customer?.instansi ?? 'Perorangan',
            o.customer?.nama_pelanggan ?? '-',
            o.total_tagihan,
            o.jumlah_dp,
            o.sisa_tagihan,
            o.jatuh_tempo ?? '',
            o.status_bayar,
          ]),
      );
      filename = `reffo-piutang-${dari ?? 'awal'}-${sampai ?? 'akhir'}.csv`;
    } else if (type === 'supplier') {
      csv = toCsv(
        ['Kode', 'Nama Supplier', 'Kontak', 'No WA', 'Alamat', 'NPWP', 'Status', 'Dibuat'],
        db.suppliers.map((s) => [
          s.kode_supplier,
          s.nama_supplier,
          s.kontak ?? '',
          s.no_wa ?? '',
          s.alamat ?? '',
          s.npwp ?? '',
          s.aktif ? 'Aktif' : 'Nonaktif',
          s.created_at.slice(0, 10),
        ]),
      );
      filename = `reffo-supplier-${dari ?? 'awal'}-${sampai ?? 'akhir'}.csv`;
    } else if (type === 'po' || type === 'hutang') {
      const rows = db.purchase_orders
        .filter((po) => inRange(po.tanggal))
        .filter((po) => type !== 'hutang' || (po.status === 'diterima' && round2(po.total - (po.sudah_dibayar ?? 0)) > 0))
        .map((po) => [
          po.no_po,
          po.tanggal.slice(0, 10),
          db.suppliers.find((s) => s.id === po.supplier_id)?.nama_supplier ?? '-',
          po.status,
          po.total,
          po.sudah_dibayar ?? 0,
          round2(po.total - (po.sudah_dibayar ?? 0)),
          po.expected_at ? po.expected_at.slice(0, 10) : '',
          po.diterima_at ? po.diterima_at.slice(0, 10) : '',
          po.catatan ?? '',
        ]);
      csv = toCsv(
        ['No PO', 'Tanggal', 'Supplier', 'Status', 'Total', 'Dibayar', 'Sisa Hutang', 'Estimasi Terima', 'Diterima', 'Catatan'],
        rows,
      );
      filename = `reffo-${type === 'hutang' ? 'hutang' : 'purchase-order'}-${dari ?? 'awal'}-${sampai ?? 'akhir'}.csv`;
    } else if (type === 'audit') {
      csv = toCsv(
        ['Waktu', 'User', 'Role', 'Aksi', 'Entitas', 'ID Entitas', 'Detail', 'IP'],
        db.audit_logs
          .filter((l) => inRange(l.created_at))
          .slice(0, 5000)
          .map((l) => [
            l.created_at,
            l.user_name,
            l.role,
            l.action,
            l.entity,
            l.entity_id ?? '',
            l.detail,
            l.ip ?? '',
          ]),
      );
      filename = `reffo-audit-${dari ?? 'awal'}-${sampai ?? 'akhir'}.csv`;
    } else if (type === 'production') {
      csv = toCsv(
        ['No Nota', 'Produk', 'Status Produksi', 'Qty', 'Luas (m2)', 'Klik', 'Mesin', 'Operator', 'Finishing', 'Deadline'],
        db.order_items
          .filter((i) => orders.some((o) => o.id === i.order_id))
          .map((i) => {
            const item = store.hydrateItem(i);
            const order = orders.find((o) => o.id === i.order_id);
            return [
              order?.no_nota ?? '-',
              item.product_name,
              item.status_produksi,
              item.qty,
              item.luas_tagihan_m2 ?? '',
              item.klik_total ?? '',
              item.machine_name ?? '',
              item.operator_name ?? '',
              item.finishing_user_name ?? '',
              order?.deadline ? order.deadline.slice(0, 10) : '',
            ];
          }),
      );
      filename = `reffo-produksi-${dari ?? 'awal'}-${sampai ?? 'akhir'}.csv`;
    } else if (type === 'stock') {
      const rows: Array<Array<string | number>> = [];
      for (const p of db.products) {
        rows.push(['Produk', p.id, p.nama_produk, p.stok_pcs ?? 0, p.satuan_hitung ?? 'pcs', p.harga_modal, p.harga_umum, p.kategori_produk]);
      }
      for (const s of db.supplies) {
        rows.push(['Bahan Pembantu', s.kode, s.nama, s.stok, s.satuan, s.harga_satuan, '', s.kategori]);
      }
      for (const r of db.material_rolls) {
        rows.push(['Roll', r.kode_roll, `${r.jenis_bahan} ${r.lebar_m}m`, r.panjang_sisa_m, 'meter', '', '', r.status]);
      }
      csv = toCsv(['Jenis', 'Kode', 'Nama', 'Stok', 'Satuan', 'HPP/Harga', 'Harga Jual', 'Keterangan'], rows);
      filename = `reffo-stok-${dari ?? 'awal'}-${sampai ?? 'akhir'}.csv`;
    } else if (type === 'insentif') {
      const laporan = hitungInsentif(db, tanggalQuery(dari), tanggalQuery(sampai));
      csv = toCsv(
        ['Staf', 'Peran', 'Total Item', 'Item Selesai', 'Job Selesai', 'Tarif Item (Rp)', 'Tarif Job (Rp)', 'Insentif Item (Rp)', 'Insentif Job (Rp)', 'Total Insentif (Rp)'],
        laporan.staf.map((row) => [
          row.nama,
          row.role,
          row.total_item,
          row.item_selesai,
          row.job_selesai,
          row.tarif_item,
          row.tarif_job,
          row.insentif_item,
          row.insentif_job,
          row.total_insentif,
        ]),
      );
      filename = `reffo-insentif-${dari ?? 'awal'}-${sampai ?? 'akhir'}.csv`;
    } else if (type === 'reklame') {
      const hari = Math.min(365, Math.max(0, Number(req.query.hari ?? PAJAK_REKLAME_HARI)));
      const { items } = hitungPajakReklame(db, hari);
      csv = toCsv(
        ['Instansi', 'Tanggal Berlaku Awal', 'Jatuh Tempo Berikutnya', 'Tahun', 'Hari Tersisa', 'No WA', 'PIC'],
        items.map((row) => [
          row.nama_instansi,
          row.pajak_reklame_expired ?? '',
          row.jatuh_tempo_berikutnya,
          row.tahun,
          row.hari_tersisa,
          row.no_wa,
          row.nama_pelanggan ?? '',
        ]),
      );
      filename = `reffo-pajak-reklame-${dari ?? 'awal'}-${sampai ?? 'akhir'}.csv`;
    } else if (type === 'profit_produk' || type === 'profit_pelanggan') {
      const laporan = hitungProfitabilitas(db, tanggalQuery(dari), tanggalQuery(sampai));
      if (type === 'profit_produk') {
        csv = toCsv(
          ['Produk', 'Kategori', 'Jumlah Item', 'Qty', 'Omzet (Rp)', 'HPP (Rp)', 'Laba Kotor (Rp)', 'Margin (%)'],
          laporan.per_produk.map((row) => [
            row.nama_produk,
            row.kategori_produk,
            row.jumlah_item,
            row.qty,
            row.omzet,
            row.hpp,
            row.laba_kotor,
            row.margin_persen,
          ]),
        );
        filename = `reffo-profit-produk-${dari ?? 'awal'}-${sampai ?? 'akhir'}.csv`;
      } else {
        csv = toCsv(
          ['Instansi', 'Jumlah Nota', 'Jumlah Item', 'Omzet Item (Rp)', 'HPP (Rp)', 'Laba Kotor (Rp)', 'Margin (%)', 'Total Tagihan (Rp)', 'Piutang (Rp)'],
          laporan.per_klien.map((row) => [
            row.instansi,
            row.jumlah_nota,
            row.jumlah_item,
            row.omzet,
            row.hpp,
            row.laba_kotor,
            row.margin_persen,
            row.total_tagihan,
            row.piutang,
          ]),
        );
        filename = `reffo-profit-pelanggan-${dari ?? 'awal'}-${sampai ?? 'akhir'}.csv`;
      }
    } else {
      csv = toCsv(
        ['No Nota', 'Tanggal', 'Instansi', 'Pelanggan', 'DPP', 'Diskon', 'PPN', 'PPh23', 'Total', 'Dibayar', 'Sisa', 'Status Bayar', 'Status Nota', 'Jatuh Tempo'],
        orders.map((o) => [
          o.no_nota,
          o.created_at.slice(0, 10),
          o.customer?.instansi ?? 'Perorangan',
          o.customer?.nama_pelanggan ?? '-',
          round2(o.total_tagihan - (o.ppn_nominal ?? 0) + (o.pph23_nominal ?? 0)),
          o.diskon_nominal ?? 0,
          o.ppn_nominal ?? 0,
          o.pph23_nominal ?? 0,
          o.total_tagihan,
          o.jumlah_dp,
          o.sisa_tagihan,
          o.status_bayar,
          o.status_nota ?? 'aktif',
          o.jatuh_tempo ?? '',
        ]),
      );
      filename = `reffo-nota-${dari ?? 'awal'}-${sampai ?? 'akhir'}.csv`;
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(`\uFEFF${csv}`);
  });

  // --- OWNER: SUPPLIER, PURCHASE ORDER, GOODS RECEIPT & HUTANG DAGANG ---
  type PoItemInput = {
    jenis?: PurchaseOrderItem['jenis'];
    referensi_id?: number;
    qty?: number;
    harga_satuan?: number;
  };

  function rincianPoItem(input: PoItemInput, poId: number): { item?: PurchaseOrderItem; error?: string } {
    const db = store.getState();
    const jenis = input.jenis;
    const referensiId = Number(input.referensi_id ?? 0);
    const qty = round2(Number(input.qty ?? 0));
    const hargaSatuan = round2(Number(input.harga_satuan ?? 0));
    if (!jenis || !['roll', 'supply', 'produk'].includes(jenis)) {
      return { error: 'Jenis barang PO tidak valid.' };
    }
    if (!(referensiId > 0) || !(qty > 0) || !(hargaSatuan >= 0)) {
      return { error: 'Barang PO memerlukan referensi, qty lebih dari 0, dan harga satuan valid.' };
    }
    const now = new Date().toISOString();
    const base = {
      id: 0,
      po_id: poId,
      jenis,
      referensi_id: referensiId,
      qty,
      harga_satuan: hargaSatuan,
      subtotal: round2(qty * hargaSatuan),
      created_at: now,
    };
    if (jenis === 'roll') {
      const roll = db.material_rolls.find((r) => r.id === referensiId);
      if (!roll) return { error: `Roll dengan ID ${referensiId} tidak ditemukan.` };
      return { item: { ...base, nama_barang: roll.jenis_bahan, kode_roll: roll.kode_roll, jenis_bahan: roll.jenis_bahan, lebar_m: roll.lebar_m, satuan: 'meter' } };
    }
    if (jenis === 'supply') {
      const supply = db.supplies.find((s) => s.id === referensiId);
      if (!supply) return { error: `Bahan pembantu dengan ID ${referensiId} tidak ditemukan.` };
      return { item: { ...base, nama_barang: supply.nama, kode_roll: null, jenis_bahan: null, lebar_m: null, satuan: supply.satuan } };
    }
    const product = db.products.find((p) => p.id === referensiId);
    if (!product) return { error: `Produk dengan ID ${referensiId} tidak ditemukan.` };
    return { item: { ...base, nama_barang: product.nama_produk, kode_roll: null, jenis_bahan: null, lebar_m: null, satuan: product.satuan_hitung ?? 'pcs' } };
  }

  function poWithSupplier(po: PurchaseOrder) {
    const db = store.getState();
    return {
      ...po,
      supplier_name: db.suppliers.find((s) => s.id === po.supplier_id)?.nama_supplier ?? '-',
      sisa_hutang: round2(po.total - (po.sudah_dibayar ?? 0)),
    };
  }

  app.get('/api/owner/suppliers', requireAuth(['owner']), (_req, res) => {
    const db = store.getState();
    const suppliers = db.suppliers
      .map((s) => ({
        ...s,
        jumlah_po: db.purchase_orders.filter((po) => po.supplier_id === s.id).length,
        total_hutang: round2(
          db.purchase_orders
            .filter((po) => po.supplier_id === s.id && po.status === 'diterima')
            .reduce((sum, po) => sum + Math.max(0, po.total - (po.sudah_dibayar ?? 0)), 0),
        ),
      }))
      .sort((a, b) => a.kode_supplier.localeCompare(b.kode_supplier));
    res.json({ suppliers });
  });

  app.post('/api/owner/suppliers', requireAuth(['owner']), (req, res) => {
    const db = store.getState();
    const body = req.body as Partial<Supplier>;
    const nama = String(body.nama_supplier ?? '').trim();
    if (!nama) {
      res.status(422).json({ error: 'Nama supplier wajib diisi.' });
      return;
    }
    const id = store.nextId('suppliers');
    const now = new Date().toISOString();
    const supplier: Supplier = {
      id,
      kode_supplier: String(body.kode_supplier ?? '').trim() || `SUP-${String(id).padStart(2, '0')}`,
      nama_supplier: nama,
      kontak: body.kontak ? String(body.kontak).trim() : null,
      no_wa: body.no_wa ? String(body.no_wa).trim() : null,
      alamat: body.alamat ? String(body.alamat).trim() : null,
      npwp: body.npwp ? String(body.npwp).trim() : null,
      aktif: body.aktif !== false,
      created_at: now,
      updated_at: now,
    };
    if (db.suppliers.some((s) => s.kode_supplier === supplier.kode_supplier)) {
      res.status(422).json({ error: 'Kode supplier sudah digunakan.' });
      return;
    }
    db.suppliers.push(supplier);
    auditRequest(req, 'supplier_create', 'supplier', supplier.id, `Supplier ${supplier.nama_supplier} ditambahkan.`);
    store.persist();
    res.status(201).json({ supplier });
  });

  app.put('/api/owner/suppliers/:id', requireAuth(['owner']), (req, res) => {
    const db = store.getState();
    const supplier = db.suppliers.find((s) => s.id === Number(req.params.id));
    if (!supplier) {
      res.status(404).json({ error: 'Supplier tidak ditemukan.' });
      return;
    }
    const body = req.body as Partial<Supplier>;
    const nama = String(body.nama_supplier ?? '').trim();
    if (!nama) {
      res.status(422).json({ error: 'Nama supplier wajib diisi.' });
      return;
    }
    const kode = String(body.kode_supplier ?? supplier.kode_supplier).trim();
    if (db.suppliers.some((s) => s.id !== supplier.id && s.kode_supplier === kode)) {
      res.status(422).json({ error: 'Kode supplier sudah digunakan.' });
      return;
    }
    supplier.kode_supplier = kode;
    supplier.nama_supplier = nama;
    supplier.kontak = body.kontak ? String(body.kontak).trim() : null;
    supplier.no_wa = body.no_wa ? String(body.no_wa).trim() : null;
    supplier.alamat = body.alamat ? String(body.alamat).trim() : null;
    supplier.npwp = body.npwp ? String(body.npwp).trim() : null;
    supplier.aktif = body.aktif !== false;
    supplier.updated_at = new Date().toISOString();
    auditRequest(req, 'supplier_update', 'supplier', supplier.id, `Supplier ${supplier.nama_supplier} diperbarui.`);
    store.persist();
    res.json({ supplier });
  });

  app.post('/api/owner/suppliers/:id/nonaktif', requireAuth(['owner']), (req, res) => {
    const db = store.getState();
    const supplier = db.suppliers.find((s) => s.id === Number(req.params.id));
    if (!supplier) {
      res.status(404).json({ error: 'Supplier tidak ditemukan.' });
      return;
    }
    supplier.aktif = false;
    supplier.updated_at = new Date().toISOString();
    auditRequest(req, 'supplier_nonaktif', 'supplier', supplier.id, `Supplier ${supplier.nama_supplier} dinonaktifkan.`);
    store.persist();
    res.json({ supplier });
  });

  app.get('/api/owner/purchase-orders', requireAuth(['owner']), (req, res) => {
    const db = store.getState();
    const status = String(req.query.status ?? '');
    let list = db.purchase_orders.map(poWithSupplier);
    if (status) list = list.filter((po) => po.status === status);
    list.sort((a, b) => new Date(b.tanggal).getTime() - new Date(a.tanggal).getTime() || b.id - a.id);
    res.json({ purchase_orders: list });
  });

  app.get('/api/owner/purchase-orders/:id', requireAuth(['owner']), (req, res) => {
    const db = store.getState();
    const po = db.purchase_orders.find((p) => p.id === Number(req.params.id));
    if (!po) {
      res.status(404).json({ error: 'Purchase order tidak ditemukan.' });
      return;
    }
    res.json({
      purchase_order: poWithSupplier(po),
      goods_receipts: db.goods_receipts.filter((gr) => gr.po_id === po.id),
      payments: db.supplier_payments.filter((p) => p.purchase_order_id === po.id),
    });
  });

  app.post('/api/owner/purchase-orders', requireAuth(['owner']), (req, res) => {
    const db = store.getState();
    const body = req.body as {
      supplier_id?: number;
      tanggal?: string;
      expected_at?: string | null;
      catatan?: string | null;
      items?: PoItemInput[];
    };
    const supplierId = Number(body.supplier_id ?? 0);
    const supplier = db.suppliers.find((s) => s.id === supplierId);
    if (!supplier || !supplier.aktif) {
      res.status(422).json({ error: 'Supplier aktif tidak ditemukan.' });
      return;
    }
    if (!Array.isArray(body.items) || body.items.length === 0) {
      res.status(422).json({ error: 'Minimal satu barang harus ditambahkan ke PO.' });
      return;
    }
    const poId = store.nextId('purchase_orders');
    const items: PurchaseOrderItem[] = [];
    for (const raw of body.items) {
      const result = rincianPoItem(raw, poId);
      if (result.error || !result.item) {
        res.status(422).json({ error: result.error ?? 'Barang PO tidak valid.' });
        return;
      }
      result.item.id = store.nextId('purchase_order_items');
      items.push(result.item);
    }
    const now = new Date().toISOString();
    const tanggal = String(body.tanggal ?? now.slice(0, 10));
    const po: PurchaseOrder = {
      id: poId,
      no_po: `PO-${tanggal.slice(0, 10).replace(/-/g, '')}-${String(poId).padStart(3, '0')}`,
      supplier_id: supplierId,
      tanggal,
      expected_at: body.expected_at ? String(body.expected_at) : null,
      status: 'draft',
      catatan: body.catatan ? String(body.catatan).trim() : null,
      total: round2(items.reduce((sum, item) => sum + item.subtotal, 0)),
      sudah_dibayar: 0,
      hutang: 0,
      diterima_at: null,
      created_at: now,
      updated_at: now,
      items,
    };
    db.purchase_orders.push(po);
    auditRequest(req, 'po_create', 'purchase_order', po.id, `PO ${po.no_po} dibuat untuk ${supplier.nama_supplier}.`);
    store.persist();
    res.status(201).json({ purchase_order: poWithSupplier(po) });
  });

  app.put('/api/owner/purchase-orders/:id', requireAuth(['owner']), (req, res) => {
    const db = store.getState();
    const po = db.purchase_orders.find((p) => p.id === Number(req.params.id));
    if (!po) {
      res.status(404).json({ error: 'Purchase order tidak ditemukan.' });
      return;
    }
    if (po.status !== 'draft') {
      res.status(422).json({ error: 'PO hanya dapat diubah saat masih berstatus draft.' });
      return;
    }
    const body = req.body as {
      supplier_id?: number;
      tanggal?: string;
      expected_at?: string | null;
      catatan?: string | null;
      items?: PoItemInput[];
    };
    const supplierId = Number(body.supplier_id ?? po.supplier_id);
    if (!db.suppliers.some((s) => s.id === supplierId && s.aktif)) {
      res.status(422).json({ error: 'Supplier aktif tidak ditemukan.' });
      return;
    }
    let items = po.items;
    if (Array.isArray(body.items) && body.items.length > 0) {
      items = [];
      for (const raw of body.items) {
        const result = rincianPoItem(raw, po.id);
        if (result.error || !result.item) {
          res.status(422).json({ error: result.error ?? 'Barang PO tidak valid.' });
          return;
        }
        result.item.id = store.nextId('purchase_order_items');
        items.push(result.item);
      }
    }
    po.supplier_id = supplierId;
    po.tanggal = String(body.tanggal ?? po.tanggal);
    po.expected_at = body.expected_at ? String(body.expected_at) : null;
    po.catatan = body.catatan ? String(body.catatan).trim() : null;
    po.items = items;
    po.total = round2(items.reduce((sum, item) => sum + item.subtotal, 0));
    po.updated_at = new Date().toISOString();
    auditRequest(req, 'po_update', 'purchase_order', po.id, `PO ${po.no_po} diperbarui.`);
    store.persist();
    res.json({ purchase_order: poWithSupplier(po) });
  });

  app.post('/api/owner/purchase-orders/:id/kirim', requireAuth(['owner']), (req, res) => {
    const db = store.getState();
    const po = db.purchase_orders.find((p) => p.id === Number(req.params.id));
    if (!po) {
      res.status(404).json({ error: 'Purchase order tidak ditemukan.' });
      return;
    }
    if (po.status !== 'draft') {
      res.status(422).json({ error: 'Hanya PO draft yang dapat dikirim.' });
      return;
    }
    po.status = 'dikirim';
    po.updated_at = new Date().toISOString();
    auditRequest(req, 'po_send', 'purchase_order', po.id, `PO ${po.no_po} dikirim ke supplier.`);
    store.persist();
    broadcastEvent('purchasing_updated', { purchaseOrderId: po.id });
    res.json({ purchase_order: poWithSupplier(po) });
  });

  app.post('/api/owner/purchase-orders/:id/terima', requireAuth(['owner']), (req, res) => {
    const db = store.getState();
    const user = getCurrentUser(req);
    const po = db.purchase_orders.find((p) => p.id === Number(req.params.id));
    if (!po) {
      res.status(404).json({ error: 'Purchase order tidak ditemukan.' });
      return;
    }
    if (po.status !== 'dikirim') {
      res.status(422).json({ error: 'Hanya PO yang sudah dikirim yang dapat diterima.' });
      return;
    }
    const now = new Date().toISOString();
    for (const item of po.items) {
      if (item.jenis === 'roll') {
        const roll = db.material_rolls.find((r) => r.id === item.referensi_id);
        if (roll) {
          roll.panjang_sisa_m = round2(roll.panjang_sisa_m + item.qty);
          if (roll.status === 'habis' && roll.panjang_sisa_m > 0) roll.status = 'aktif';
        }
      } else if (item.jenis === 'supply') {
        const supply = db.supplies.find((s) => s.id === item.referensi_id);
        if (supply) {
          supply.stok = round2(supply.stok + item.qty);
          supply.updated_at = now;
        }
      } else {
        const product = db.products.find((p) => p.id === item.referensi_id);
        if (product) product.stok_pcs = round2((product.stok_pcs ?? 0) + item.qty);
      }
    }
    const receipt: GoodsReceipt = {
      id: store.nextId('goods_receipts'),
      po_id: po.id,
      no_po: po.no_po,
      tanggal: String((req.body as { tanggal?: string }).tanggal ?? now.slice(0, 10)),
      admin_id: user?.id ?? 0,
      admin_name: user?.name ?? null,
      catatan: (req.body as { catatan?: string }).catatan?.trim() || null,
      created_at: now,
    };
    db.goods_receipts.push(receipt);
    po.status = 'diterima';
    po.diterima_at = now;
    po.hutang = round2(po.total - (po.sudah_dibayar ?? 0));
    po.updated_at = now;
    auditRequest(req, 'goods_receipt', 'purchase_order', po.id, `PO ${po.no_po} diterima; stok bertambah dan hutang dicatat.`);
    store.persist();
    broadcastEvent('purchasing_updated', { purchaseOrderId: po.id });
    res.json({ purchase_order: poWithSupplier(po), goods_receipt: receipt });
  });

  app.post('/api/owner/purchase-orders/:id/bayar', requireAuth(['owner']), (req, res) => {
    const db = store.getState();
    const user = getCurrentUser(req);
    const po = db.purchase_orders.find((p) => p.id === Number(req.params.id));
    if (!po) {
      res.status(404).json({ error: 'Purchase order tidak ditemukan.' });
      return;
    }
    if (po.status !== 'diterima') {
      res.status(422).json({ error: 'Pembayaran hanya untuk PO yang sudah diterima.' });
      return;
    }
    const body = req.body as { nominal?: number; metode?: PaymentMethod; keterangan?: string; tanggal?: string };
    const nominal = round2(Number(body.nominal ?? 0));
    const sisa = round2(po.total - (po.sudah_dibayar ?? 0));
    if (!(nominal > 0) || nominal > sisa + 0.001) {
      res.status(422).json({ error: `Nominal pembayaran harus antara Rp 1 dan sisa hutang Rp ${sisa.toLocaleString('id-ID')}.` });
      return;
    }
    const metode: PaymentMethod = ['Tunai', 'Transfer', 'QRIS'].includes(String(body.metode)) ? (body.metode as PaymentMethod) : 'Transfer';
    const now = new Date().toISOString();
    const payment: SupplierPayment = {
      id: store.nextId('supplier_payments'),
      supplier_id: po.supplier_id,
      purchase_order_id: po.id,
      no_po: po.no_po,
      tanggal: String(body.tanggal ?? now.slice(0, 10)),
      nominal,
      metode,
      keterangan: body.keterangan?.trim() || null,
      admin_id: user?.id ?? 0,
      admin_name: user?.name ?? null,
      created_at: now,
    };
    db.supplier_payments.push(payment);
    po.sudah_dibayar = round2((po.sudah_dibayar ?? 0) + nominal);
    po.hutang = round2(Math.max(0, po.total - po.sudah_dibayar));
    po.updated_at = now;
    auditRequest(req, 'supplier_payment', 'purchase_order', po.id, `Pembayaran ${payment.metode} Rp ${nominal.toLocaleString('id-ID')} untuk ${po.no_po}.`);
    store.persist();
    broadcastEvent('purchasing_updated', { purchaseOrderId: po.id });
    res.json({ payment, purchase_order: poWithSupplier(po) });
  });

  app.get('/api/owner/goods-receipts', requireAuth(['owner']), (_req, res) => {
    const db = store.getState();
    const receipts = db.goods_receipts
      .map((gr) => ({
        ...gr,
        supplier_name: db.suppliers.find((s) => s.id === db.purchase_orders.find((po) => po.id === gr.po_id)?.supplier_id)?.nama_supplier ?? '-',
      }))
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    res.json({ goods_receipts: receipts });
  });

  app.get('/api/owner/supplier-payments', requireAuth(['owner']), (_req, res) => {
    const db = store.getState();
    const payments = db.supplier_payments
      .map((p) => ({
        ...p,
        supplier_name: db.suppliers.find((s) => s.id === p.supplier_id)?.nama_supplier ?? '-',
      }))
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    res.json({ payments });
  });

  // --- OWNER: WHATSAPP OUTBOX & PEMELIHARAAN ---
  app.get('/api/owner/whatsapp-outbox', requireAuth(['owner']), (req, res) => {
    const db = store.getState();
    const status = String(req.query.status ?? '');
    let outbox = [...db.whatsapp_outbox];
    if (status) outbox = outbox.filter((w) => w.status === status);
    outbox.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    res.json({
      outbox: outbox.slice(0, 500),
      gateway_terkonfigurasi: Boolean(WHATSAPP_WEBHOOK_URL),
      webhook_url: WHATSAPP_WEBHOOK_URL ? WHATSAPP_WEBHOOK_URL.replace(/\/+$/, '') : null,
    });
  });

  app.post('/api/owner/whatsapp-outbox/:id/retry', requireAuth(['owner']), (req, res) => {
    const db = store.getState();
    const row = db.whatsapp_outbox.find((w) => w.id === Number(req.params.id));
    if (!row) {
      res.status(404).json({ error: 'Pesan outbox tidak ditemukan.' });
      return;
    }
    row.status = 'pending';
    row.attempts = 0;
    row.last_error = WHATSAPP_WEBHOOK_URL ? null : 'Gateway WhatsApp belum dikonfigurasi (WHATSAPP_WEBHOOK_URL).';
    row.next_attempt_at = null;
    row.updated_at = new Date().toISOString();
    auditRequest(req, 'whatsapp_retry', 'whatsapp_outbox', row.id, `Pesan ${row.event} diantrekan ulang.`);
    store.persist();
    void deliverWaOutbox();
    res.json({ outbox: row });
  });

  app.post('/api/owner/whatsapp/reminder', requireAuth(['owner']), (req, res) => {
    const db = store.getState();
    const hari = Math.min(30, Math.max(0, Number((req.body as { hari?: number }).hari ?? 7)));
    const batas = Date.now() + hari * 86_400_000;
    const hariIni = new Date().toISOString().slice(0, 10);
    let dibuat = 0;
    for (const raw of db.orders.filter(activeOrderRaw)) {
      const order = store.hydrateOrder(raw);
      if (!(order.sisa_tagihan > 0)) continue;
      const due = order.jatuh_tempo ? new Date(order.jatuh_tempo).getTime() : new Date(new Date(order.created_at).getTime() + 30 * 86_400_000).getTime();
      if (due > batas) continue;
      if (enqueueWa(
        'piutang_jatuh_tempo',
        `piutang_jatuh_tempo:${order.id}:${hariIni}`,
        order.customer?.no_wa ?? '',
        `Pengingat: Nota ${order.no_nota} memiliki sisa tagihan Rp ${order.sisa_tagihan.toLocaleString('id-ID')} dengan jatuh tempo ${order.jatuh_tempo ? order.jatuh_tempo.slice(0, 10) : '-'}.`,
        order.id,
        `${appBaseUrl()}/?nota=${order.no_nota}`,
      )) {
        dibuat += 1;
      }
    }
    auditRequest(req, 'whatsapp_reminder', 'whatsapp_outbox', 0, `Pengingat piutang dibuat: ${dibuat} pesan.`);
    store.persist();
    res.json({ dibuat, total_outbox: db.whatsapp_outbox.length });
  });

  app.get('/api/owner/pajak-reklame', requireAuth(['owner']), (req, res) => {
    const db = store.getState();
    const hari = Math.min(365, Math.max(0, Number(req.query.hari ?? PAJAK_REKLAME_HARI)));
    const { semua, items } = hitungPajakReklame(db, hari);
    res.json({
      hari,
      items,
      instansis: semua,
      total_terdaftar: semua.length,
      gateway_terkonfigurasi: Boolean(WHATSAPP_WEBHOOK_URL),
    });
  });

  app.put('/api/owner/pajak-reklame/:id', requireAuth(['owner']), (req, res) => {
    const db = store.getState();
    const inst = db.instansis.find((i) => i.id === Number(req.params.id));
    if (!inst) {
      res.status(404).json({ error: 'Instansi tidak ditemukan.' });
      return;
    }
    const body = req.body as { pajak_reklame_expired?: unknown; tanggal?: unknown };
    const mentah = body.pajak_reklame_expired ?? body.tanggal ?? '';
    const tanggal = String(mentah ?? '').trim();
    if (tanggal && !parseTanggalIso(tanggal)) {
      res.status(400).json({ error: 'Tanggal pajak reklame harus berformat YYYY-MM-DD.' });
      return;
    }
    const sebelumnya = inst.pajak_reklame_expired ?? null;
    inst.pajak_reklame_expired = tanggal || null;
    auditRequest(
      req,
      'pajak_reklame_update',
      'instansi',
      inst.id,
      `Masa berlaku pajak reklame diubah dari ${sebelumnya ?? '-'} menjadi ${inst.pajak_reklame_expired ?? '-'}.`,
    );
    store.persist();
    broadcastEvent('domain_update', { instansiId: inst.id });
    res.json({ instansi: inst });
  });

  app.post('/api/owner/whatsapp/reminder-reklame', requireAuth(['owner']), (req, res) => {
    const db = store.getState();
    const hari = Math.min(365, Math.max(0, Number((req.body as { hari?: number }).hari ?? PAJAK_REKLAME_HARI)));
    const sekarang = new Date();
    const { items } = hitungPajakReklame(db, hari, sekarang);
    let dibuat = 0;
    let dilewati = 0;
    for (const row of items) {
      if (!normalizeWaNumber(row.no_wa)) {
        dilewati += 1;
        continue;
      }
      if (enqueueWa(
        'pajak_reklame_jatuh_tempo',
        `pajak_reklame_jatuh_tempo:${row.instansi_id}:${row.tahun}`,
        row.no_wa,
        `Pengingat pajak reklame: ${row.nama_instansi} memiliki masa berlaku hingga ${row.jatuh_tempo_berikutnya} (${row.hari_tersisa} hari lagi). Mohon segera perpanjang dan unggah bukti pembayaran.`,
        null,
        null,
      )) {
        dibuat += 1;
      }
    }
    auditRequest(
      req,
      'whatsapp_reminder_reklame',
      'whatsapp_outbox',
      0,
      `Pengingat pajak reklame dibuat: ${dibuat} pesan, ${dilewati} tanpa nomor WA.`,
    );
    store.persist();
    res.json({ dibuat, dilewati, total_outbox: db.whatsapp_outbox.length });
  });

  app.get('/api/owner/maintenance/tiff-preview', requireAuth(['owner']), (req, res) => {
    const hari = Number(req.query.hari ?? AUTO_CLEAN_TIFF_HARI);
    const hasil = hapusTiffLama(hari, null, true);
    res.json({ hari, kandidat: hasil, total: hasil.length });
  });

  app.post('/api/owner/maintenance/tiff-clean', requireAuth(['owner']), (req, res) => {
    const user = getCurrentUser(req) ?? null;
    const hari = Number((req.body as { hari?: number }).hari ?? AUTO_CLEAN_TIFF_HARI);
    const hasil = hapusTiffLama(hari, user, false);
    auditRequest(req, 'auto_clean_tiff_run', 'maintenance', 0, `Auto-clean TIFF dijalankan (${hari} hari): ${hasil.filter((h) => h.dihapus).length} file dihapus.`);
    res.json({ hari, hasil, dihapus: hasil.filter((h) => h.dihapus).length });
  });

  // --- OWNER: DASHBOARD, REPORTS & SETTINGS ---
  app.get('/api/owner/dashboard', requireAuth(['owner']), (_req, res) => {
    const db = store.getState();
    const orders = db.orders.map((o) => store.hydrateOrder(o)).filter((o) => activeOrderRaw(o));

    const statistik = {
      desain: db.order_items.filter((i) => ['menunggu_desain', 'proses_desain', 'menunggu_acc', 'revisi'].includes(i.status_produksi)).length,
      cetak: db.order_items.filter((i) => ['antrean_cetak', 'proses_cetak'].includes(i.status_produksi)).length,
      finishing: db.order_items.filter((i) => ['antrean_finishing', 'proses_finishing'].includes(i.status_produksi)).length,
      advertising: db.advertising_spks.filter((s) => s.status_lapangan !== 'selesai').length,
      siap_diambil: db.order_items.filter((i) => i.status_produksi === 'siap_diambil').length,
    };

    const threeDaysAhead = Date.now() + 3 * 86400_000;
    const deadlines = orders
      .filter(
        (o) =>
          o.deadline &&
          new Date(o.deadline).getTime() <= threeDaysAhead &&
          o.items.some((i) => i.status_produksi !== 'selesai'),
      )
      .sort((a, b) => new Date(a.deadline!).getTime() - new Date(b.deadline!).getTime())
      .slice(0, 10)
      .map((o) => {
        const diffDays = Math.ceil((new Date(o.deadline!).getTime() - Date.now()) / 86400_000);
        return {
          id: o.id,
          no_nota: o.no_nota,
          instansi: o.customer?.instansi ?? 'Perorangan',
          pic: o.customer?.nama_pelanggan ?? '-',
          deadline: o.deadline,
          terlambat: new Date(o.deadline!).getTime() < Date.now(),
          sisa_hari: diffDays,
        };
      });

    const rekapMap = new Map<
      string,
      {
        instansi: string;
        total_nota: number;
        omzet: number;
        piutang: number;
        pics: Map<string, { nama: string; total_nota: number; omzet: number; piutang: number }>;
      }
    >();

    for (const o of orders) {
      const inst = o.customer?.instansi ?? 'Perorangan';
      const pic = o.customer?.nama_pelanggan ?? '-';
      if (!rekapMap.has(inst)) {
        rekapMap.set(inst, { instansi: inst, total_nota: 0, omzet: 0, piutang: 0, pics: new Map() });
      }
      const grp = rekapMap.get(inst)!;
      grp.total_nota += 1;
      grp.omzet = round2(grp.omzet + o.total_tagihan);
      grp.piutang = round2(grp.piutang + o.sisa_tagihan);

      if (!grp.pics.has(pic)) {
        grp.pics.set(pic, { nama: pic, total_nota: 0, omzet: 0, piutang: 0 });
      }
      const p = grp.pics.get(pic)!;
      p.total_nota += 1;
      p.omzet = round2(p.omzet + o.total_tagihan);
      p.piutang = round2(p.piutang + o.sisa_tagihan);
    }

    const rekap = Array.from(rekapMap.values())
      .map((g) => ({ ...g, pics: Array.from(g.pics.values()) }))
      .sort((a, b) => b.omzet - a.omzet);

    const stok_kritis = {
      rolls: db.material_rolls
        .filter((r) => r.status === 'aktif' && r.panjang_sisa_m <= 10)
        .sort((a, b) => a.panjang_sisa_m - b.panjang_sisa_m),
      products: db.products
        .filter((p) => p.kategori_produk === 'satuan' && p.stok_pcs !== null && p.stok_pcs <= 5)
        .sort((a, b) => (a.stok_pcs ?? 0) - (b.stok_pcs ?? 0)),
    };

    res.json({
      statistik,
      deadlines,
      stok_kritis,
      rekap,
      total_rekap: {
        nota: orders.length,
        omzet: round2(orders.reduce((s, o) => s + o.total_tagihan, 0)),
        piutang: round2(orders.reduce((s, o) => s + o.sisa_tagihan, 0)),
      },
    });
  });

  app.get('/api/owner/reports/materials', requireAuth(['owner']), (req, res) => {
    const db = store.getState();
    const dari = req.query.dari ? String(req.query.dari) : null;
    const sampai = req.query.sampai ? String(req.query.sampai) : null;

    let logs = db.material_logs.map((l) => {
      const item = db.order_items.find((i) => i.id === l.order_item_id);
      const order = item ? db.orders.find((o) => o.id === item.order_id) : null;
      const product = item ? db.products.find((p) => p.id === item.product_id) : null;
      const roll = l.material_roll_id ? db.material_rolls.find((r) => r.id === l.material_roll_id) : null;
      return {
        ...l,
        no_nota: order?.no_nota ?? '-',
        product_name: product?.nama_produk ?? '-',
        kode_roll: roll?.kode_roll ?? null,
      };
    });

    if (dari) logs = logs.filter((l) => l.created_at.slice(0, 10) >= dari);
    if (sampai) logs = logs.filter((l) => l.created_at.slice(0, 10) <= sampai);
    logs.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    const ringkasan = {
      jumlah_log: logs.length,
      netto: round2(logs.reduce((s, l) => s + l.luas_netto_m2, 0)),
      finishing: round2(logs.reduce((s, l) => s + l.wos_finishing_m2, 0)),
      potong: round2(logs.reduce((s, l) => s + l.wos_potong_m2, 0)),
      gagal: round2(logs.reduce((s, l) => s + l.gagal_cetak_m2, 0)),
      total: round2(
        logs.reduce(
          (s, l) => s + l.luas_netto_m2 + l.wos_finishing_m2 + l.wos_potong_m2 + l.gagal_cetak_m2,
          0,
        ),
      ),
    };

    res.json({
      rolls: db.material_rolls.map((r) => ({
        ...r,
        luas_sisa_m2: round2(r.lebar_m * r.panjang_sisa_m),
        persen_sisa: r.panjang_awal_m > 0 ? round2((r.panjang_sisa_m / r.panjang_awal_m) * 100) : 0,
      })),
      offcuts: db.material_offcuts.filter((o) => o.status === 'tersedia'),
      stok_pcs: db.products.filter((p) => p.kategori_produk === 'satuan'),
      ringkasan,
      logs,
    });
  });

  app.get('/api/owner/reports/profit-loss', requireAuth(['owner']), (req, res) => {
    const db = store.getState();
    const dari = req.query.dari ? String(req.query.dari) : null;
    const sampai = req.query.sampai ? String(req.query.sampai) : null;

    let orders = db.orders.filter((o) => activeOrderRaw(o));
    let logs = db.material_logs;
    let expenses = db.operational_expenses;

    if (dari) {
      orders = orders.filter((o) => o.created_at.slice(0, 10) >= dari);
      logs = logs.filter((l) => l.created_at.slice(0, 10) >= dari);
      expenses = expenses.filter((e) => e.tanggal >= dari);
    }
    if (sampai) {
      orders = orders.filter((o) => o.created_at.slice(0, 10) <= sampai);
      logs = logs.filter((l) => l.created_at.slice(0, 10) <= sampai);
      expenses = expenses.filter((e) => e.tanggal <= sampai);
    }

    const omzetTagihan = round2(orders.reduce((s, o) => s + o.total_tagihan, 0));
    const cashMasuk = round2(orders.reduce((s, o) => s + o.jumlah_dp, 0));

    const calcKomp = (field: 'luas_netto_m2' | 'wos_finishing_m2' | 'wos_potong_m2' | 'gagal_cetak_m2') => {
      let luas = 0;
      let biaya = 0;
      for (const log of logs) {
        const item = db.order_items.find((i) => i.id === log.order_item_id);
        const prod = item ? db.products.find((p) => p.id === item.product_id) : null;
        const val = log[field];
        luas += val;
        biaya += val * (prod?.harga_modal ?? 0);
      }
      return { luas: round2(luas), biaya: round2(biaya) };
    };

    const komponen_hpp = {
      netto: calcKomp('luas_netto_m2'),
      finishing: calcKomp('wos_finishing_m2'),
      potong: calcKomp('wos_potong_m2'),
      gagal: calcKomp('gagal_cetak_m2'),
    };
    const hppBahan = round2(
      komponen_hpp.netto.biaya +
        komponen_hpp.finishing.biaya +
        komponen_hpp.potong.biaya +
        komponen_hpp.gagal.biaya,
    );

    const orderIds = new Set(orders.map((o) => o.id));
    const hppSatuan = round2(
      db.order_items
        .filter((i) => orderIds.has(i.order_id))
        .reduce((sum, i) => {
          const prod = db.products.find((p) => p.id === i.product_id);
          if (prod?.kategori_produk === 'satuan') {
            return sum + i.qty * prod.harga_modal;
          }
          return sum;
        }, 0),
    );

    const hppProduksi = round2(hppBahan + hppSatuan);
    const totalOperasional = round2(expenses.reduce((s, e) => s + e.nominal, 0));
    const labaBersih = round2(omzetTagihan - hppProduksi - totalOperasional);

    res.json({
      omzet: { tagihan: omzetTagihan, cash_masuk: cashMasuk, jumlah_nota: orders.length },
      komponen_hpp,
      hpp_bahan: hppBahan,
      hpp_satuan: hppSatuan,
      hpp_produksi: hppProduksi,
      total_operasional: totalOperasional,
      laba_bersih: labaBersih,
      expenses: [...expenses].sort((a, b) => b.tanggal.localeCompare(a.tanggal)),
    });
  });

  app.post('/api/owner/expenses', requireAuth(['owner']), (req, res) => {
    const { tanggal, kategori_biaya, keterangan, nominal } = req.body as {
      tanggal?: string;
      kategori_biaya?: ExpenseCategory;
      keterangan?: string;
      nominal?: number;
    };
    if (!tanggal || !kategori_biaya || !keterangan?.trim() || !(Number(nominal) > 0)) {
      res.status(422).json({ error: 'Tanggal, kategori, keterangan, dan nominal (> 0) wajib diisi.' });
      return;
    }
    const db = store.getState();
    const expense = {
      id: store.nextId('operational_expenses'),
      tanggal,
      kategori_biaya,
      keterangan: keterangan.trim(),
      nominal: round2(Number(nominal)),
      created_at: new Date().toISOString(),
    };
    db.operational_expenses.push(expense);
    store.persist();
    broadcastEvent('expense_updated');
    res.status(201).json({ expense });
  });

  app.delete('/api/owner/expenses/:id', requireAuth(['owner']), (req, res) => {
    const db = store.getState();
    const idx = db.operational_expenses.findIndex((e) => e.id === Number(req.params.id));
    if (idx === -1) {
      res.status(404).json({ error: 'Data pengeluaran tidak ditemukan.' });
      return;
    }
    db.operational_expenses.splice(idx, 1);
    store.persist();
    broadcastEvent('expense_updated');
    res.json({ deleted: true });
  });

  app.put('/api/owner/settings/products', requireAuth(['owner']), (req, res) => {
    const { products } = req.body as {
      products: Array<{
        id: number;
        harga_umum: number;
        harga_reseller: number;
        harga_prioritas: number;
        harga_pegawai: number;
        harga_modal: number;
        mesin_default_id?: number | null;
        satuan_hitung?: 'pcs' | 'klik';
        klik_per_lembar?: number;
        ukuran_lembar?: string | null;
      }>;
    };
    const db = store.getState();
    for (const row of products ?? []) {
      const target = db.products.find((p) => p.id === Number(row.id));
      if (target) {
        target.harga_umum = round2(Number(row.harga_umum));
        target.harga_reseller = round2(Number(row.harga_reseller));
        target.harga_prioritas = round2(Number(row.harga_prioritas));
        target.harga_pegawai = round2(Number(row.harga_pegawai));
        target.harga_modal = round2(Number(row.harga_modal));
        target.mesin_default_id = row.mesin_default_id ? Number(row.mesin_default_id) : null;
        target.satuan_hitung = row.satuan_hitung === 'klik' ? 'klik' : 'pcs';
        target.klik_per_lembar = Math.max(1, Math.floor(Number(row.klik_per_lembar ?? 1)) || 1);
        target.ukuran_lembar = row.ukuran_lembar?.trim() || null;
      }
    }
    store.persist();
    broadcastEvent('settings_updated');
    res.json({ products: db.products });
  });

  app.post('/api/owner/settings/rolls', requireAuth(['owner']), (req, res) => {
    const { kode_roll, jenis_bahan } = req.body as { kode_roll?: string; jenis_bahan?: string };
    const kode = (kode_roll ?? '').trim().toUpperCase();
    const spec = jenis_bahan ? STANDARD_ROLL_SPECS[jenis_bahan] : null;
    if (!kode || !jenis_bahan || !spec) {
      res.status(422).json({ error: 'Kode roll dan jenis bahan standar wajib valid.' });
      return;
    }
    const db = store.getState();
    if (db.material_rolls.some((r) => r.kode_roll === kode)) {
      res.status(422).json({ error: `Kode roll ${kode} sudah terdaftar.` });
      return;
    }
    const roll = {
      id: store.nextId('material_rolls'),
      kode_roll: kode,
      jenis_bahan,
      lebar_m: spec.lebar_m,
      panjang_awal_m: spec.panjang_m,
      panjang_sisa_m: spec.panjang_m,
      status: 'aktif' as const,
    };
    db.material_rolls.push(roll);
    store.persist();
    broadcastEvent('stock_updated');
    res.status(201).json({ roll });
  });

  app.post('/api/owner/settings/stok-pcs', requireAuth(['owner']), (req, res) => {
    const { product_id, jumlah } = req.body as { product_id?: number; jumlah?: number };
    const db = store.getState();
    const product = db.products.find((p) => p.id === Number(product_id));
    if (!product || product.kategori_produk !== 'satuan') {
      res.status(422).json({ error: 'Produk satuan tidak ditemukan.' });
      return;
    }
    const qty = Math.floor(Number(jumlah ?? 0));
    if (qty <= 0) {
      res.status(422).json({ error: 'Jumlah penambahan stok minimal 1 pcs.' });
      return;
    }
    product.stok_pcs = (product.stok_pcs ?? 0) + qty;
    store.persist();
    broadcastEvent('stock_updated');
    res.json({ product });
  });

  app.put('/api/owner/settings/finishings', requireAuth(['owner']), (req, res) => {
    const { finishings } = req.body as {
      finishings: Array<{
        id: number;
        ekstra_kiri_cm: number;
        ekstra_kanan_cm: number;
        ekstra_atas_cm: number;
        ekstra_bawah_cm: number;
      }>;
    };
    const db = store.getState();
    for (const row of finishings ?? []) {
      const target = db.finishings.find((f) => f.id === Number(row.id));
      if (target) {
        target.ekstra_kiri_cm = round2(Number(row.ekstra_kiri_cm));
        target.ekstra_kanan_cm = round2(Number(row.ekstra_kanan_cm));
        target.ekstra_atas_cm = round2(Number(row.ekstra_atas_cm));
        target.ekstra_bawah_cm = round2(Number(row.ekstra_bawah_cm));
      }
    }
    store.persist();
    broadcastEvent('settings_updated');
    res.json({ finishings: db.finishings });
  });

  app.post('/api/owner/settings/machines', requireAuth(['owner']), (req, res) => {
    const body = req.body as Record<string, unknown>;
    const kode = String(body.kode_mesin ?? '').trim().toUpperCase();
    const nama = String(body.nama_mesin ?? '').trim();
    const jenis = String(body.jenis ?? '') as PrintMachine['jenis'];
    if (!kode || !nama || !['large_format', 'uv', 'digital_a3p', 'cutting'].includes(jenis)) {
      res.status(422).json({ error: 'Kode, nama, dan jenis mesin wajib valid.' });
      return;
    }
    const db = store.getState();
    if (db.machines.some((m) => m.kode_mesin === kode || m.nama_mesin === nama)) {
      res.status(422).json({ error: 'Kode atau nama mesin sudah terdaftar.' });
      return;
    }
    const now = new Date().toISOString();
    const machine: PrintMachine = {
      id: store.nextId('machines'),
      kode_mesin: kode,
      nama_mesin: nama,
      jenis,
      lebar_max_m: Number(body.lebar_max_m) > 0 ? Number(body.lebar_max_m) : null,
      konsumsi_tinta_ml_per_m2: Math.max(0, Number(body.konsumsi_tinta_ml_per_m2 ?? 0)),
      aktif: body.aktif !== false,
      keterangan: String(body.keterangan ?? '').trim() || null,
      created_at: now,
      updated_at: now,
    };
    db.machines.push(machine);
    auditRequest(req, 'machine_created', 'machine', machine.id, `Mesin ${nama} ditambahkan.`);
    store.persist();
    broadcastEvent('settings_updated');
    res.status(201).json({ machine });
  });

  app.put('/api/owner/settings/machines/:id', requireAuth(['owner']), (req, res) => {
    const db = store.getState();
    const machine = db.machines.find((m) => m.id === Number(req.params.id));
    if (!machine) {
      res.status(404).json({ error: 'Mesin tidak ditemukan.' });
      return;
    }
    const body = req.body as Record<string, unknown>;
    machine.nama_mesin = String(body.nama_mesin ?? machine.nama_mesin).trim() || machine.nama_mesin;
    machine.lebar_max_m = Number(body.lebar_max_m) > 0 ? Number(body.lebar_max_m) : null;
    machine.konsumsi_tinta_ml_per_m2 = Math.max(
      0,
      Number(body.konsumsi_tinta_ml_per_m2 ?? machine.konsumsi_tinta_ml_per_m2),
    );
    machine.aktif = body.aktif !== false;
    machine.keterangan = String(body.keterangan ?? '').trim() || null;
    machine.updated_at = new Date().toISOString();
    auditRequest(req, 'machine_updated', 'machine', machine.id, `Mesin ${machine.nama_mesin} diperbarui.`);
    store.persist();
    broadcastEvent('settings_updated');
    res.json({ machine });
  });

  app.post('/api/owner/settings/supplies', requireAuth(['owner']), (req, res) => {
    const body = req.body as Record<string, unknown>;
    const kode = String(body.kode ?? '').trim().toUpperCase();
    const nama = String(body.nama ?? '').trim();
    const kategori = String(body.kategori ?? '') as SupplyItem['kategori'];
    if (!kode || !nama || !['tinta', 'bahan_pembantu', 'suku_cadang'].includes(kategori)) {
      res.status(422).json({ error: 'Kode, nama, dan kategori barang wajib valid.' });
      return;
    }
    const db = store.getState();
    if (db.supplies.some((s) => s.kode === kode)) {
      res.status(422).json({ error: `Kode ${kode} sudah terdaftar.` });
      return;
    }
    const now = new Date().toISOString();
    const supply: SupplyItem = {
      id: store.nextId('supplies'),
      kode,
      nama,
      kategori,
      satuan: String(body.satuan ?? 'pcs').trim() || 'pcs',
      stok: Math.max(0, Number(body.stok ?? 0)),
      stok_minimum: Math.max(0, Number(body.stok_minimum ?? 0)),
      harga_satuan: Math.max(0, Number(body.harga_satuan ?? 0)),
      konsumsi_per_m2: Number(body.konsumsi_per_m2) > 0 ? Number(body.konsumsi_per_m2) : null,
      aktif: body.aktif !== false,
      created_at: now,
      updated_at: now,
    };
    db.supplies.push(supply);
    auditRequest(req, 'supply_created', 'supply', supply.id, `Barang ${nama} ditambahkan.`);
    store.persist();
    broadcastEvent('stock_updated');
    res.status(201).json({ supply });
  });

  app.put('/api/owner/settings/supplies/:id', requireAuth(['owner']), (req, res) => {
    const db = store.getState();
    const supply = db.supplies.find((s) => s.id === Number(req.params.id));
    if (!supply) {
      res.status(404).json({ error: 'Barang tidak ditemukan.' });
      return;
    }
    const body = req.body as Record<string, unknown>;
    supply.nama = String(body.nama ?? supply.nama).trim() || supply.nama;
    supply.satuan = String(body.satuan ?? supply.satuan).trim() || supply.satuan;
    supply.stok_minimum = Math.max(0, Number(body.stok_minimum ?? supply.stok_minimum));
    supply.harga_satuan = Math.max(0, Number(body.harga_satuan ?? supply.harga_satuan));
    supply.konsumsi_per_m2 = Number(body.konsumsi_per_m2) > 0 ? Number(body.konsumsi_per_m2) : null;
    supply.aktif = body.aktif !== false;
    supply.updated_at = new Date().toISOString();
    auditRequest(req, 'supply_updated', 'supply', supply.id, `Barang ${supply.nama} diperbarui.`);
    store.persist();
    broadcastEvent('stock_updated');
    res.json({ supply });
  });

  app.post('/api/owner/settings/supplies/:id/restock', requireAuth(['owner']), (req, res) => {
    const db = store.getState();
    const supply = db.supplies.find((s) => s.id === Number(req.params.id));
    if (!supply) {
      res.status(404).json({ error: 'Barang tidak ditemukan.' });
      return;
    }
    const jumlah = round2(Number((req.body as { jumlah?: number }).jumlah ?? 0));
    if (!(jumlah > 0)) {
      res.status(422).json({ error: 'Jumlah restock wajib lebih dari 0.' });
      return;
    }
    supply.stok = round2(supply.stok + jumlah);
    supply.updated_at = new Date().toISOString();
    auditRequest(req, 'supply_restock', 'supply', supply.id, `Restock ${supply.nama} sebanyak ${jumlah} ${supply.satuan}.`);
    store.persist();
    broadcastEvent('stock_updated');
    res.json({ supply });
  });

  app.get('/api/owner/reports/kpi', requireAuth(['owner']), (_req, res) => {
    const db = store.getState();
    const activeOrders = new Set(db.orders.filter(activeOrderRaw).map((o) => o.id));
    const activeItems = db.order_items.filter((i) => activeOrders.has(i.order_id));
    const operatorStats = db.users
      .filter((u) => u.role === 'operator_cetak' && u.active !== false)
      .map((u) => {
        const items = activeItems.filter((i) => i.operator_id === u.id);
        const itemIds = new Set(items.map((i) => i.id));
        const logs = db.material_logs.filter((l) => itemIds.has(l.order_item_id));
        return {
          user_id: u.id,
          nama: u.name,
          total_job: items.length,
          sukses: items.filter((i) => ['antrean_finishing', 'proses_finishing', 'siap_diambil', 'selesai'].includes(i.status_produksi)).length,
          luas_sukses_m2: round2(logs.reduce((a, l) => a + l.luas_netto_m2, 0)),
          luas_gagal_m2: round2(logs.reduce((a, l) => a + l.gagal_cetak_m2, 0)),
          total_klik: items.reduce((a, i) => a + (i.klik_total ?? 0), 0),
          estimasi_tinta_ml: round2(items.reduce((a, i) => a + (i.estimasi_tinta_ml ?? 0), 0)),
        };
      });
    const machineStats = db.machines.map((m) => {
      const items = activeItems.filter((i) => i.machine_id === m.id);
      const itemIds = new Set(items.map((i) => i.id));
      const logs = db.material_logs.filter((l) => itemIds.has(l.order_item_id));
      return {
        machine_id: m.id,
        kode_mesin: m.kode_mesin,
        nama_mesin: m.nama_mesin,
        jenis: m.jenis,
        aktif: m.aktif,
        total_job: items.length,
        luas_cetak_m2: round2(logs.reduce((a, l) => a + l.luas_netto_m2, 0)),
        luas_gagal_m2: round2(logs.reduce((a, l) => a + l.gagal_cetak_m2, 0)),
        total_klik: items.reduce((a, i) => a + (i.klik_total ?? 0), 0),
        estimasi_tinta_ml: round2(items.reduce((a, i) => a + (i.estimasi_tinta_ml ?? 0), 0)),
      };
    });
    const lowSupplies = db.supplies
      .filter((s) => s.aktif && s.stok <= s.stok_minimum)
      .map((s) => ({ ...s, selisih: round2(s.stok - s.stok_minimum) }));
    const batches = [...db.print_batches].reverse().slice(0, 20).map((b) => ({
      ...b,
      machine_name: db.machines.find((m) => m.id === b.machine_id)?.nama_mesin ?? null,
      operator_name: db.users.find((u) => u.id === b.operator_id)?.name ?? null,
    }));
    res.json({ operatorStats, machineStats, lowSupplies, batches });
  });

  app.get('/api/owner/kpi/insentif', requireAuth(['owner']), (req, res) => {
    const db = store.getState();
    res.json(
      hitungInsentif(db, tanggalQuery(req.query.dari), tanggalQuery(req.query.sampai)),
    );
  });

  app.put('/api/owner/kpi/insentif/rates', requireAuth(['owner']), (req, res) => {
    const db = store.getState();
    const input = (req.body as {
      rates?: Array<{ role?: unknown; jenis?: unknown; nominal?: unknown }>;
    }).rates;
    if (!Array.isArray(input) || input.length === 0) {
      res.status(400).json({ error: 'Daftar tarif insentif tidak boleh kosong.' });
      return;
    }
    const user = getCurrentUser(req);
    const sekarang = new Date().toISOString();
    const validated: Array<{ role: InsentifRole; jenis: InsentifJenis; nominal: number }> = [];
    const kunci = new Set<string>();
    for (const entry of input) {
      const role = String(entry?.role ?? '') as InsentifRole;
      const jenis = String(entry?.jenis ?? '') as InsentifJenis;
      const nominal = Number(entry?.nominal);
      const key = `${role}:${jenis}`;
      if (!INSENTIF_ROLES.includes(role) || !INSENTIF_JENIS.includes(jenis)) {
        res.status(400).json({ error: 'Peran atau jenis tarif insentif tidak dikenal.' });
        return;
      }
      if (!Number.isFinite(nominal) || nominal < 0 || nominal > 1_000_000_000) {
        res.status(400).json({ error: `Nominal tarif ${role}/${jenis} tidak valid.` });
        return;
      }
      if (kunci.has(key)) {
        res.status(400).json({ error: `Tarif ${role}/${jenis} dikirim lebih dari sekali.` });
        return;
      }
      kunci.add(key);
      validated.push({ role, jenis, nominal: round2(nominal) });
    }

    if (!Array.isArray(db.insentif_rates)) db.insentif_rates = [];
    for (const entry of validated) {
      let rate = db.insentif_rates.find(
        (r) => r.role === entry.role && r.jenis === entry.jenis,
      );
      if (!rate) {
        rate = {
          id: store.nextId('insentif_rates'),
          role: entry.role,
          jenis: entry.jenis,
          nominal: entry.nominal,
          updated_at: sekarang,
          updated_by: user.id,
        };
        db.insentif_rates.push(rate);
        continue;
      }
      rate.nominal = entry.nominal;
      rate.updated_at = sekarang;
      rate.updated_by = user.id;
    }
    auditRequest(
      req,
      'insentif_rates_update',
      'insentif_rate',
      0,
      `Tarif insentif diperbarui: ${validated.map((r) => `${r.role}/${r.jenis}=${r.nominal}`).join(', ')}.`,
    );
    store.persist();
    broadcastEvent('domain_update', { entity: 'insentif_rates' });
    res.json({ rates: db.insentif_rates, updated: validated.length });
  });

  app.get('/api/owner/reports/profitabilitas', requireAuth(['owner']), (req, res) => {
    const db = store.getState();
    res.json(
      hitungProfitabilitas(db, tanggalQuery(req.query.dari), tanggalQuery(req.query.sampai)),
    );
  });

  // --- ERROR HANDLER (UPLOAD & VALIDASI) ---
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (res.headersSent) return;
    if (err instanceof multer.MulterError) {
      const message =
        err.code === 'LIMIT_FILE_SIZE'
          ? `Ukuran file melebihi batas ${MAX_UPLOAD_MB} MB.`
          : err.code === 'LIMIT_UNEXPECTED_FILE'
            ? 'Jenis file tidak diizinkan. Gunakan JPG/PNG/PDF/TIFF/AI/PSD/CDR/ZIP/RAR.'
            : `Gagal mengunggah file: ${err.message}`;
      res.status(422).json({ error: message });
      return;
    }
    const message = err instanceof Error ? err.message : 'Terjadi kesalahan pada server.';
    res.status(500).json({ error: message });
  });

  return app;
}

async function start() {
  await store.init();
  const app = buildApp();
  const isProd = process.env.NODE_ENV === 'production';

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Reffo PrintFlow server berjalan pada http://0.0.0.0:${PORT}`);
    void deliverWaOutbox();
    const worker = setInterval(() => void deliverWaOutbox(), 60_000);
    worker.unref();
  });
}

start();

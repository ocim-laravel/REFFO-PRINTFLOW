/**
 * Bridge WhatsApp lokal untuk Reffo PrintFlow.
 *
 * Menjadi penerima WHATSAPP_WEBHOOK_URL aplikasi (default http://127.0.0.1:3101/send)
 * lalu meneruskan pesan ke WhatsApp lewat Baileys. Sesi login disimpan di
 * wa-bridge/auth/, jadi QR hanya perlu dipindai sekali.
 *
 * Jalankan: npm run wa:bridge
 * QR       : http://127.0.0.1:3101/qr
 * Status   : http://127.0.0.1:3101/health
 */
import 'dotenv/config';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import QRCode from 'qrcode';
import makeWASocket, {
  Browsers,
  DisconnectReason,
  useMultiFileAuthState,
} from '@whiskeysockets/baileys';

const HOST = process.env.WA_BRIDGE_HOST || '127.0.0.1';
const PORT = Number(process.env.WA_BRIDGE_PORT || 3101);
const AUTH_DIR = path.resolve(process.cwd(), process.env.WA_BRIDGE_AUTH_DIR || 'wa-bridge/auth');
// Pakai token yang sama dengan aplikasi agar tidak perlu mengisi dua kali.
const EXPECTED_TOKEN =
  process.env.WA_BRIDGE_TOKEN || process.env.WHATSAPP_WEBHOOK_TOKEN || '';

if (!EXPECTED_TOKEN) {
  console.error(
    '[WA] WA_BRIDGE_TOKEN / WHATSAPP_WEBHOOK_TOKEN kosong. Bridge menolak start agar endpoint /send tidak terbuka tanpa autentikasi.',
  );
  process.exit(1);
}

let sock = null;
let connectionState = 'starting';
let currentQr = null;
let phoneNumber = null;
const delivered = new Set();

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1_000_000) throw new Error('Payload terlalu besar.');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf-8'));
}

function toJid(value) {
  const digits = String(value ?? '').replace(/\D/g, '');
  if (!digits) return null;
  let number = digits;
  if (number.startsWith('0')) number = `62${number.slice(1)}`;
  else if (number.startsWith('8')) number = `62${number}`;
  if (number.length < 10 || number.length > 16) return null;
  return `${number}@s.whatsapp.net`;
}

function composeText(message, link) {
  const pesan = String(message ?? '').trim();
  const tautan = String(link ?? '').trim();
  if (!tautan || pesan.includes(tautan)) return pesan;
  return pesan ? `${pesan}\n${tautan}` : tautan;
}

async function connect() {
  await fs.mkdir(AUTH_DIR, { recursive: true });
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

  sock = makeWASocket({
    auth: state,
    browser: Browsers.macOS('Chrome'),
    printQRInTerminal: false,
    generateHighQualityLinkPreview: false,
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      currentQr = qr;
      console.log('[WA] QR siap. Buka http://127.0.0.1:' + PORT + '/qr untuk memindai.');
    }

    if (connection === 'connecting') {
      connectionState = 'connecting';
    }

    if (connection === 'open') {
      connectionState = 'connected';
      currentQr = null;
      phoneNumber = sock?.user?.id?.split('@')[0] ?? null;
      console.log('[WA] Tersambung sebagai', phoneNumber ?? '(nomor tidak terbaca)');
    }

    if (connection === 'close') {
      currentQr = null;
      const statusCode =
        lastDisconnect?.error?.output?.statusCode ?? lastDisconnect?.error?.statusCode;
      const loggedOut = statusCode === DisconnectReason.loggedOut;
      sock = null;
      phoneNumber = null;

      if (loggedOut) {
        connectionState = 'logged_out';
        await fs.rm(AUTH_DIR, { recursive: true, force: true });
        console.log('[WA] Sesi logout. Folder auth dihapus; QR baru akan dibuat.');
      } else {
        connectionState = 'reconnecting';
        console.log('[WA] Koneksi terputus, mencoba lagi dalam 3 detik.');
      }
      setTimeout(() => void connect(), 3000);
    }
  });
}

async function handleSend(req, res) {
  if (EXPECTED_TOKEN) {
    const header = String(req.headers.authorization ?? '');
    const token = header.startsWith('Bearer ') ? header.slice(7) : header;
    if (token !== EXPECTED_TOKEN) {
      return json(res, 401, { ok: false, error: 'Token bridge tidak valid.' });
    }
  }

  if (!sock || connectionState !== 'connected') {
    return json(res, 503, {
      ok: false,
      error: `WhatsApp belum siap (${connectionState}). Buka /qr bila perlu pindai.`,
    });
  }

  let body;
  try {
    body = await readJson(req);
  } catch (error) {
    return json(res, 400, { ok: false, error: `JSON tidak valid: ${error.message}` });
  }

  const jid = toJid(body.to);
  if (!jid) {
    return json(res, 400, { ok: false, error: 'Nomor tujuan tidak valid.' });
  }

  const dedupeKey = String(body.dedupe_key ?? '').trim();
  if (dedupeKey && delivered.has(dedupeKey)) {
    return json(res, 200, { ok: true, duplicate: true, id: null });
  }

  const text = composeText(body.message, body.link);
  if (!text) {
    return json(res, 400, { ok: false, error: 'Pesan kosong.' });
  }

  try {
    let payload = { text };
    const mediaPath = typeof body.media_path === 'string' ? body.media_path.trim() : '';
    if (mediaPath) {
      const uploadsDir = path.resolve(process.cwd(), 'uploads');
      const cleaned = mediaPath.replace(/^\/+uploads\/+/, '');
      const resolved = path.resolve(uploadsDir, path.basename(cleaned));
      if (resolved.startsWith(uploadsDir + path.sep) && /\.(png|jpe?g|webp)$/i.test(resolved)) {
        try {
          const imageBuffer = await fs.readFile(resolved);
          payload = { image: imageBuffer, caption: text };
        } catch {
          // fallback ke pesan teks bila file tidak ditemukan
        }
      }
    }
    const result = await sock.sendMessage(jid, payload);
    if (dedupeKey) delivered.add(dedupeKey);
    return json(res, 200, {
      ok: true,
      duplicate: false,
      id: result?.key?.id ?? null,
      event: body.event ?? null,
      to: jid.replace('@s.whatsapp.net', ''),
    });
  } catch (error) {
    return json(res, 502, {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

  if (url.pathname === '/health') {
    return json(res, 200, {
      status: 'ok',
      whatsapp: connectionState,
      phone: phoneNumber,
      qrAvailable: Boolean(currentQr),
      qrUrl: currentQr ? `http://${HOST}:${PORT}/qr` : null,
    });
  }

  if (url.pathname === '/qr') {
    if (!currentQr) {
      return json(res, 404, { error: 'QR tidak tersedia. WhatsApp mungkin sudah tersambung.' });
    }
    const svg = await QRCode.toString(currentQr, { type: 'svg', margin: 2, width: 420 });
    res.writeHead(200, { 'Content-Type': 'image/svg+xml; charset=utf-8' });
    return res.end(svg);
  }

  if (url.pathname === '/send' && req.method === 'POST') {
    return handleSend(req, res);
  }

  return json(res, 404, { error: 'Endpoint tidak ditemukan.' });
});

server.listen(PORT, HOST, () => {
  console.log(`[WA Bridge] Mendengarkan di http://${HOST}:${PORT}`);
  console.log(`[WA Bridge] QR       : http://${HOST}:${PORT}/qr`);
  console.log(`[WA Bridge] Status   : http://${HOST}:${PORT}/health`);
  void connect().catch((error) => {
    console.error('[WA Bridge] Gagal memulai WhatsApp:', error);
    connectionState = 'error';
  });
});

process.on('SIGINT', () => {
  server.close(() => process.exit(0));
});

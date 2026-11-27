/**
 * Validasi konfigurasi keamanan saat startup.
 *
 * Aturan Fase 1:
 * - Produksi wajib memakai SESSION_SECRET acak minimal 32 karakter.
 * - Produksi wajib mengisi WHATSAPP_WEBHOOK_TOKEN dan WA_BRIDGE_TOKEN agar
 *   endpoint bridge WhatsApp tidak bisa dipakai tanpa autentikasi.
 * - Mode development hanya memberi peringatan, tidak memblokir startup.
 */

export const MIN_SESSION_SECRET_LENGTH = 32;

const PLACEHOLDER_SECRETS = new Set([
  'change-this-secret-in-production',
  'change-me',
  'secret',
  'password',
  'password123',
  'my_secret',
  'my-secret',
  'reffo',
]);

export interface SecurityEnvResult {
  errors: string[];
  warnings: string[];
}

function isProduction(env: NodeJS.ProcessEnv): boolean {
  return String(env.NODE_ENV ?? '').toLowerCase() === 'production';
}

function filled(value: unknown): string {
  return String(value ?? '').trim();
}

export function validateSecurityEnv(env: NodeJS.ProcessEnv = process.env): SecurityEnvResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const production = isProduction(env);

  const sessionSecret = filled(env.SESSION_SECRET);
  if (!sessionSecret) {
    (production ? errors : warnings).push(
      'SESSION_SECRET belum diisi. Di produksi server menolak berjalan tanpa secret acak.',
    );
  } else if (sessionSecret.length < MIN_SESSION_SECRET_LENGTH) {
    (production ? errors : warnings).push(
      `SESSION_SECRET terlalu pendek (${sessionSecret.length} karakter). Gunakan minimal ${MIN_SESSION_SECRET_LENGTH} karakter acak.`,
    );
  } else if (PLACEHOLDER_SECRETS.has(sessionSecret.toLowerCase())) {
    (production ? errors : warnings).push(
      'SESSION_SECRET masih memakai nilai contoh. Ganti dengan string acak sebelum go-live.',
    );
  }

  const waToken = filled(env.WHATSAPP_WEBHOOK_TOKEN);
  const bridgeToken = filled(env.WA_BRIDGE_TOKEN);
  if (!waToken) {
    (production ? errors : warnings).push(
      'WHATSAPP_WEBHOOK_TOKEN kosong. Bridge WhatsApp akan menolak start agar endpoint /send tidak terbuka.',
    );
  }
  if (!bridgeToken) {
    (production ? errors : warnings).push(
      'WA_BRIDGE_TOKEN kosong. Isi token yang sama dengan WHATSAPP_WEBHOOK_TOKEN agar bridge aman.',
    );
  }
  if (waToken && bridgeToken && waToken !== bridgeToken) {
    warnings.push(
      'WA_BRIDGE_TOKEN berbeda dengan WHATSAPP_WEBHOOK_TOKEN. Bridge memakai WA_BRIDGE_TOKEN; pastikan keduanya sama.',
    );
  }

  const demoSwitch = String(env.ENABLE_DEMO_SWITCH ?? 'false').trim().toLowerCase();
  if (production && demoSwitch !== 'false') {
    errors.push(
      'ENABLE_DEMO_SWITCH harus "false" di produksi agar login cepat divisi tanpa kata sandi tidak aktif.',
    );
  }

  return { errors, warnings };
}

export function assertSecurityEnv(env: NodeJS.ProcessEnv = process.env): void {
  const { errors, warnings } = validateSecurityEnv(env);
  for (const warning of warnings) {
    console.warn(`[security] ${warning}`);
  }
  if (errors.length > 0) {
    throw new Error(
      `Konfigurasi keamanan belum aman untuk produksi:\n- ${errors.join('\n- ')}\n` +
        'Perbaiki .env lalu jalankan ulang server.',
    );
  }
}

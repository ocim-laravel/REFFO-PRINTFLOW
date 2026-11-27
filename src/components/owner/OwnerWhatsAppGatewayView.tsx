import React, { useCallback, useEffect, useState } from 'react';
import { Eye, EyeOff, MessageCircle, RefreshCw, Save, Send } from 'lucide-react';
import type { WhatsAppGatewayConfig } from '../../types';
import { apiFetch } from '../../lib/api';
import { formatTanggalSingkat } from '../../lib/format';

interface OwnerWhatsAppGatewayViewProps {
  onNotify: (type: 'success' | 'error', message: string) => void;
  apiPrefix?: string;
  title?: string;
}

interface GatewayResponse {
  config: WhatsAppGatewayConfig;
  gateway_terkonfigurasi: boolean;
  webhook_url: string | null;
  app_url: string;
}

export const OwnerWhatsAppGatewayView: React.FC<OwnerWhatsAppGatewayViewProps> = ({
  onNotify,
  apiPrefix = '/api/owner/settings/whatsapp',
  title = 'Setting WhatsApp Gateway',
}) => {
  const [webhookUrl, setWebhookUrl] = useState('');
  const [webhookToken, setWebhookToken] = useState('');
  const [appUrl, setAppUrl] = useState('');
  const [aktif, setAktif] = useState(true);
  const [showToken, setShowToken] = useState(false);
  const [nomorUji, setNomorUji] = useState('');
  const [status, setStatus] = useState<GatewayResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch<GatewayResponse>(apiPrefix);
      setStatus(res);
      setWebhookUrl(res.config.webhook_url ?? '');
      setWebhookToken(res.config.webhook_token ?? '');
      setAppUrl(res.config.app_url ?? res.app_url);
      setAktif(res.config.aktif !== false);
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Gagal memuat setting WhatsApp Gateway.');
    } finally {
      setLoading(false);
    }
  }, [apiPrefix, onNotify]);

  useEffect(() => {
    load();
  }, [load]);

  const validUrl = (value: string, label: string): boolean => {
    if (!value.trim()) return true;
    try {
      const parsed = new URL(value.trim());
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error();
      return true;
    } catch {
      onNotify('error', `${label} harus berupa URL http/https yang valid.`);
      return false;
    }
  };

  const simpan = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validUrl(webhookUrl, 'Webhook URL') || !validUrl(appUrl, 'APP URL')) return;
    setSaving(true);
    try {
      const res = await apiFetch<GatewayResponse>(apiPrefix, {
        method: 'PUT',
        body: JSON.stringify({
          webhook_url: webhookUrl,
          webhook_token: webhookToken,
          app_url: appUrl,
          aktif,
        }),
      });
      setStatus(res);
      onNotify(
        'success',
        res.gateway_terkonfigurasi
          ? 'Konfigurasi WhatsApp Gateway tersimpan dan langsung aktif.'
          : 'Konfigurasi tersimpan, tetapi gateway belum aktif. Isi Webhook URL dan aktifkan gateway.',
      );
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Gagal menyimpan WhatsApp Gateway.');
    } finally {
      setSaving(false);
    }
  };

  const uji = async () => {
    if (!nomorUji.trim()) {
      onNotify('error', 'Isi nomor WhatsApp tujuan terlebih dahulu.');
      return;
    }
    setTesting(true);
    try {
      const res = await apiFetch<{ ok: boolean; to: string }>(`${apiPrefix}/test`, {
        method: 'POST',
        body: JSON.stringify({ no_wa: nomorUji }),
      });
      onNotify('success', `Pesan uji berhasil dikirim ke ${res.to}.`);
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Gagal mengirim pesan uji.');
    } finally {
      setTesting(false);
    }
  };

  const inputClass =
    'mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100';
  const labelClass = 'block text-xs font-semibold text-slate-600';

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-semibold text-slate-900">{title}</h2>
          <p className="text-sm text-slate-500">
            Konfigurasi gateway notifikasi. Perubahan langsung dipakai sistem tanpa restart server.
          </p>
        </div>
        <button
          type="button"
          onClick={load}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          Segarkan
        </button>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <form onSubmit={simpan} className="rounded-xl border border-slate-200 bg-white p-5 xl:col-span-2 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="font-semibold text-slate-900 text-sm">Konfigurasi Gateway</h3>
              <p className="mt-0.5 text-xs text-slate-500">
                Untuk bridge lokal: <code className="rounded bg-slate-100 px-1">http://127.0.0.1:3101/send</code>
              </p>
            </div>
            <span
              className={`rounded-md border px-2 py-0.5 text-[11px] font-semibold ${
                status?.gateway_terkonfigurasi
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                  : 'border-amber-200 bg-amber-50 text-amber-700'
              }`}
            >
              {status?.gateway_terkonfigurasi ? 'Aktif' : 'Belum Aktif'}
            </span>
          </div>

          <div>
            <label className={labelClass} htmlFor="wa-webhook">
              Webhook URL
            </label>
            <input
              id="wa-webhook"
              type="url"
              value={webhookUrl}
              onChange={(e) => setWebhookUrl(e.target.value)}
              placeholder="http://127.0.0.1:3101/send"
              className={inputClass}
            />
            <p className="mt-1 text-[11px] text-slate-500">
              Kosongkan untuk menonaktifkan pengiriman. Pesan tetap masuk antrean outbox.
            </p>
          </div>

          <div>
            <label className={labelClass} htmlFor="wa-token">
              Webhook Token
            </label>
            <div className="mt-1 flex gap-2">
              <input
                id="wa-token"
                type={showToken ? 'text' : 'password'}
                value={webhookToken}
                onChange={(e) => setWebhookToken(e.target.value)}
                placeholder="Opsional"
                autoComplete="off"
                className={inputClass}
              />
              <button
                type="button"
                onClick={() => setShowToken((v) => !v)}
                className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-600 hover:bg-slate-50 cursor-pointer"
                title={showToken ? 'Sembunyikan token' : 'Tampilkan token'}
              >
                {showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          <div>
            <label className={labelClass} htmlFor="wa-app-url">
              APP URL (tautan Self-ACC & nota)
            </label>
            <input
              id="wa-app-url"
              type="url"
              value={appUrl}
              onChange={(e) => setAppUrl(e.target.value)}
              placeholder="http://localhost:3000"
              className={inputClass}
            />
          </div>

          <label className="flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 cursor-pointer">
            <input
              type="checkbox"
              checked={aktif}
              onChange={(e) => setAktif(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-slate-300"
            />
            <span className="text-xs text-slate-700">
              <span className="font-semibold">Aktifkan gateway</span>
              <span className="block text-slate-500">Nonaktifkan sementara tanpa menghapus konfigurasi.</span>
            </span>
          </label>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
            <p className="text-[11px] text-slate-500">
              {status?.config.updated_at
                ? `Terakhir diubah ${formatTanggalSingkat(status.config.updated_at)}`
                : 'Konfigurasi bawaan dari file .env'}
            </p>
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-1.5 rounded-lg bg-blue-700 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-800 disabled:opacity-60 cursor-pointer"
            >
              <Save className="h-3.5 w-3.5" />
              {saving ? 'Menyimpan...' : 'Simpan Konfigurasi'}
            </button>
          </div>
        </form>

        <div className="space-y-4">
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="flex items-center gap-2">
              <MessageCircle className="h-4 w-4 text-blue-700" />
              <h3 className="font-semibold text-slate-900 text-sm">Uji Koneksi</h3>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              Kirim pesan uji memakai konfigurasi yang sudah tersimpan.
            </p>
            <label className={`${labelClass} mt-4`} htmlFor="wa-test-number">
              Nomor WhatsApp
            </label>
            <input
              id="wa-test-number"
              type="tel"
              value={nomorUji}
              onChange={(e) => setNomorUji(e.target.value)}
              placeholder="08123456789"
              className={inputClass}
            />
            <button
              type="button"
              onClick={uji}
              disabled={testing}
              className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-700 hover:bg-blue-100 disabled:opacity-60 cursor-pointer"
            >
              <Send className="h-3.5 w-3.5" />
              {testing ? 'Mengirim...' : 'Kirim Pesan Uji'}
            </button>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-5 text-xs text-slate-600 space-y-2">
            <h3 className="font-semibold text-slate-900 text-sm">Panduan Bridge Lokal</h3>
            <p>1. Jalankan <code className="rounded bg-slate-100 px-1">npm run wa:bridge</code> di terminal terpisah.</p>
            <p>2. Pindai QR sekali di <code className="rounded bg-slate-100 px-1">http://127.0.0.1:3101/qr</code>.</p>
            <p>3. Pastikan status di <code className="rounded bg-slate-100 px-1">/health</code> = <strong>connected</strong>.</p>
            <p>4. Simpan URL bridge di atas, lalu uji kirim.</p>
          </div>
        </div>
      </div>
    </div>
  );
};

import React, { useMemo, useState } from 'react';
import { X, Plus, Trash2, Wand2, Upload } from 'lucide-react';
import type {
  Customer,
  CustomerCategory,
  DesignStatus,
  Finishing,
  Instansi,
  Order,
  PaymentStatus,
  Product,
} from '../../types';
import { KATEGORI_PELANGGAN_LABEL, STATUS_DESAIN_LABEL, formatDesimal, formatRupiah } from '../../lib/format';
import { apiFetch } from '../../lib/api';

interface OrderCreateModalProps {
  open: boolean;
  onClose: () => void;
  products: Product[];
  finishings: Finishing[];
  instansis: Instansi[];
  customers: Customer[];
  onCreated: (order: Order) => void;
  onInstansiAdded: (instansi: Instansi) => void;
  onNotify: (type: 'success' | 'error', message: string) => void;
}

interface DraftItem {
  key: string;
  nama_item: string;
  product_id: number;
  finishing_id: string;
  lebar_m: string;
  tinggi_m: string;
  qty: string;
  diskon_persen: string;
}

function getPrice(product: Product | undefined, kategori: CustomerCategory): number {
  if (!product) return 0;
  switch (kategori) {
    case 'reseller':
      return product.harga_reseller;
    case 'prioritas':
      return product.harga_prioritas;
    case 'pegawai':
      return product.harga_pegawai;
    default:
      return product.harga_umum;
  }
}

export const OrderCreateModal: React.FC<OrderCreateModalProps> = ({
  open,
  onClose,
  products,
  finishings,
  instansis,
  customers,
  onCreated,
  onInstansiAdded,
  onNotify,
}) => {
  const defaultProductId = products[0]?.id ?? 1;
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>('');
  const [instansiId, setInstansiId] = useState<string>(String(instansis[0]?.id ?? ''));
  const [newInstansiName, setNewInstansiName] = useState('');
  const [newInstansiPajak, setNewInstansiPajak] = useState('');
  const [showNewInstansi, setShowNewInstansi] = useState(false);

  const [namaPelanggan, setNamaPelanggan] = useState('');
  const [noWa, setNoWa] = useState('');
  const [kategori, setKategori] = useState<CustomerCategory>('umum');
  const [alamat, setAlamat] = useState('');

  const [items, setItems] = useState<DraftItem[]>([
    {
      key: 'row-1',
      nama_item: '',
      product_id: defaultProductId,
      finishing_id: String(finishings[0]?.id ?? ''),
      lebar_m: '3',
      tinggi_m: '1',
      qty: '1',
      diskon_persen: '0',
    },
  ]);

  const [statusBayar, setStatusBayar] = useState<PaymentStatus>('dp');
  const [jumlahDp, setJumlahDp] = useState('');
  const [statusDesain, setStatusDesain] = useState<DesignStatus>('belum_ada_file');
  const [catatanDesain, setCatatanDesain] = useState('');
  const [deadline, setDeadline] = useState('');
  const [briefingFile, setBriefingFile] = useState<File | null>(null);

  const [diskonNota, setDiskonNota] = useState('0');
  const [ppnPersen, setPpnPersen] = useState('');
  const [pph23Persen, setPph23Persen] = useState('');
  const [jatuhTempo, setJatuhTempo] = useState('');
  const [overrideCredit, setOverrideCredit] = useState(false);
  const [selfAcc, setSelfAcc] = useState(true);

  const [spkEnabled, setSpkEnabled] = useState(false);
  const [spkJenis, setSpkJenis] = useState('');
  const [spkUkuran, setSpkUkuran] = useState('');
  const [spkLokasi, setSpkLokasi] = useState('');
  const [spkCatatan, setSpkCatatan] = useState('');

  // AI WA Order Parser
  const [showAiParser, setShowAiParser] = useState(false);
  const [waText, setWaText] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const handleSelectExistingCustomer = (val: string) => {
    setSelectedCustomerId(val);
    if (!val) return;
    const found = customers.find((c) => c.id === Number(val));
    if (found) {
      setInstansiId(String(found.instansi_id));
      setNamaPelanggan(found.nama_pelanggan);
      setNoWa(found.no_wa);
      setKategori(found.kategori);
      setAlamat(found.alamat ?? '');
    }
  };

  const handleAddInstansi = async () => {
    if (!newInstansiName.trim()) return;
    try {
      const res = await apiFetch<{ instansi: Instansi }>('/api/instansis', {
        method: 'POST',
        body: JSON.stringify({
          nama_instansi: newInstansiName.trim(),
          pajak_reklame_expired: newInstansiPajak || null,
        }),
      });
      onInstansiAdded(res.instansi);
      setInstansiId(String(res.instansi.id));
      setNewInstansiName('');
      setNewInstansiPajak('');
      setShowNewInstansi(false);
      onNotify('success', `Instansi "${res.instansi.nama_instansi}" ditambahkan.`);
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Gagal menambahkan instansi.');
    }
  };

  const handleAiParse = async () => {
    if (!waText.trim()) return;
    setAiLoading(true);
    try {
      const res = await apiFetch<{
        parsed: {
          instansi?: string;
          nama_pelanggan?: string;
          no_wa?: string;
          kategori?: CustomerCategory;
          catatan_desain?: string;
          items?: Array<{
            nama_item?: string;
            product_id?: number;
            finishing_id?: number | null;
            lebar_m?: number | null;
            tinggi_m?: number | null;
            qty?: number;
          }>;
        };
      }>('/api/ai/parse-order', {
        method: 'POST',
        body: JSON.stringify({ text: waText }),
      });

      const p = res.parsed;
      if (p.nama_pelanggan) setNamaPelanggan(p.nama_pelanggan);
      if (p.no_wa) setNoWa(p.no_wa);
      if (p.kategori && ['umum', 'reseller', 'prioritas', 'pegawai'].includes(p.kategori)) {
        setKategori(p.kategori);
      }
      if (p.catatan_desain) setCatatanDesain(p.catatan_desain);
      if (p.instansi) {
        const matched = instansis.find(
          (i) => i.nama_instansi.toLowerCase().includes(p.instansi!.toLowerCase()),
        );
        if (matched) setInstansiId(String(matched.id));
      }
      if (Array.isArray(p.items) && p.items.length > 0) {
        setItems(
          p.items.map((it, idx) => ({
            key: `ai-${Date.now()}-${idx}`,
            nama_item: it.nama_item ?? '',
            product_id: products.some((pr) => pr.id === it.product_id)
              ? Number(it.product_id)
              : defaultProductId,
            finishing_id: it.finishing_id ? String(it.finishing_id) : '',
            lebar_m: it.lebar_m ? String(it.lebar_m) : '1',
            tinggi_m: it.tinggi_m ? String(it.tinggi_m) : '1',
            qty: String(it.qty ?? 1),
            diskon_persen: '0',
          })),
        );
      }
      setShowAiParser(false);
      onNotify('success', 'Pesan WhatsApp berhasil diekstrak ke formulir nota.');
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Gagal mengekstrak pesan.');
    } finally {
      setAiLoading(false);
    }
  };

  const calculated = useMemo(() => {
    let totalSebelumDiskon = 0;
    const rows = items.map((row) => {
      const prod = products.find((p) => p.id === row.product_id);
      const harga = getPrice(prod, kategori);
      const qty = Math.max(1, Math.floor(Number(row.qty) || 1));
      const isMeteran = prod?.kategori_produk === 'meteran';
      const lebar = isMeteran ? Math.max(0, Number(row.lebar_m) || 0) : 0;
      const tinggi = isMeteran ? Math.max(0, Number(row.tinggi_m) || 0) : 0;
      const luas = isMeteran ? Math.round(lebar * tinggi * qty * 100) / 100 : 0;
      const hargaSebelumDiskon = isMeteran ? Math.round(harga * luas) : Math.round(harga * qty);
      const diskonPersen = Math.min(Math.max(Number(row.diskon_persen) || 0, 0), 100);
      const diskonNominal = Math.round((hargaSebelumDiskon * diskonPersen) / 100);
      const subtotal = hargaSebelumDiskon - diskonNominal;
      totalSebelumDiskon += subtotal;
      return {
        key: row.key,
        prod,
        harga,
        qty,
        isMeteran,
        luas,
        hargaSebelumDiskon,
        diskonPersen,
        diskonNominal,
        subtotal,
      };
    });
    const selectedInst = instansis.find((i) => i.id === Number(instansiId));
    const effectivePpn =
      ppnPersen !== ''
        ? Number(ppnPersen) || 0
        : selectedInst?.is_pkp
          ? Number(selectedInst.ppn_persen ?? 11)
          : Number(selectedInst?.ppn_persen ?? 0);
    const effectivePph =
      pph23Persen !== ''
        ? Number(pph23Persen) || 0
        : Number(selectedInst?.pph23_persen ?? 0);
    const diskonNotaPersen = Math.min(Math.max(Number(diskonNota) || 0, 0), 100);
    const diskonNotaNominal = Math.round((totalSebelumDiskon * diskonNotaPersen) / 100);
    const dpp = totalSebelumDiskon - diskonNotaNominal;
    const ppnNominal = Math.round((dpp * effectivePpn) / 100);
    const pphNominal = Math.round((dpp * effectivePph) / 100);
    const total = dpp + ppnNominal - pphNominal;
    return {
      rows,
      totalSebelumDiskon,
      diskonNotaPersen,
      diskonNotaNominal,
      dpp,
      effectivePpn,
      effectivePph,
      ppnNominal,
      pphNominal,
      total,
      selectedInst,
    };
  }, [items, products, kategori, instansis, instansiId, ppnPersen, pph23Persen, diskonNota]);

  const addItemRow = () => {
    setItems((prev) => [
      ...prev,
      {
        key: `row-${Date.now()}`,
        nama_item: '',
        product_id: defaultProductId,
        finishing_id: '',
        lebar_m: '2',
        tinggi_m: '1',
        qty: '1',
        diskon_persen: '0',
      },
    ]);
  };

  const removeItemRow = (key: string) => {
    if (items.length <= 1) return;
    setItems((prev) => prev.filter((r) => r.key !== key));
  };

  const updateRow = (key: string, patch: Partial<DraftItem>) => {
    setItems((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const selectedInst = instansis.find((i) => i.id === Number(instansiId));
      const payload = {
        customer_id: selectedCustomerId ? Number(selectedCustomerId) : undefined,
        instansi_id: instansiId ? Number(instansiId) : undefined,
        instansi: selectedInst?.nama_instansi ?? 'Perorangan',
        nama_pelanggan: namaPelanggan,
        no_wa: noWa,
        kategori,
        alamat,
        status_bayar: statusBayar,
        jumlah_dp: statusBayar === 'dp' ? Number(jumlahDp || 0) : undefined,
        status_desain: statusDesain,
        catatan_desain: catatanDesain,
        deadline: deadline || undefined,
        diskon_persen: calculated.diskonNotaPersen,
        ppn_persen: calculated.effectivePpn,
        pph23_persen: calculated.effectivePph,
        jatuh_tempo: jatuhTempo || undefined,
        override_credit: overrideCredit,
        self_acc: selfAcc,
        items: items.map((r) => {
          const prod = products.find((p) => p.id === r.product_id);
          const isMeteran = prod?.kategori_produk === 'meteran';
          return {
            nama_item: r.nama_item,
            product_id: r.product_id,
            finishing_id: isMeteran && r.finishing_id ? Number(r.finishing_id) : null,
            lebar_m: isMeteran ? Number(r.lebar_m) : null,
            tinggi_m: isMeteran ? Number(r.tinggi_m) : null,
            qty: Number(r.qty) || 1,
            diskon_persen: Number(r.diskon_persen) || 0,
          };
        }),
        spk_enabled: spkEnabled,
        spk_jenis_pekerjaan: spkJenis,
        spk_ukuran_konstruksi: spkUkuran,
        spk_lokasi_pasang: spkLokasi,
        spk_catatan_teknis: spkCatatan,
      };

      const fd = new FormData();
      fd.append('payload', JSON.stringify(payload));
      if (briefingFile) {
        fd.append('lampiran_briefing', briefingFile);
      }

      const res = await apiFetch<{ order: Order }>('/api/orders', {
        method: 'POST',
        body: fd,
      });
      onCreated(res.order);
      onClose();
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Gagal menyimpan nota.');
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-slate-950/60 p-4 overflow-y-auto">
      <div className="bg-white rounded-xl border border-slate-200 w-full max-w-4xl my-6 overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between gap-4">
          <div>
            <h2 className="font-display text-lg font-semibold text-slate-900">Buat Nota Order Baru</h2>
            <p className="text-xs text-slate-500">
              Harga otomatis menyesuaikan kategori pelanggan dan luas meteran.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowAiParser((v) => !v)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-100 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Wand2 className="h-3.5 w-3.5" />
              Ekstrak Pesan WA
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 cursor-pointer"
              aria-label="Tutup form"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {/* Optional WhatsApp AI Parser Drawer */}
          {showAiParser && (
            <div className="rounded-lg border border-blue-200 bg-blue-50/50 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-blue-900">
                  Tempel pesan order WhatsApp pelanggan untuk isi form otomatis
                </p>
                <button
                  type="button"
                  onClick={() =>
                    setWaText(
                      'Halo admin, saya Raka dari Universitas Merdeka Nusantara (082198765432). Mau pesan Spanduk MMT 340 ukuran 4 x 1.5 meter sebanyak 2 lembar finishing Siming Keling, sama X-Banner 3 pcs.',
                    )
                  }
                  className="text-xs text-blue-700 underline cursor-pointer"
                >
                  Isi contoh pesan
                </button>
              </div>
              <textarea
                rows={3}
                value={waText}
                onChange={(e) => setWaText(e.target.value)}
                placeholder="Contoh: Pesan spanduk MMT 280 ukuran 3x1m qty 2 finishing siming keling atas nama..."
                className="w-full rounded-lg border border-blue-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
              />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowAiParser(false)}
                  className="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="button"
                  disabled={aiLoading || !waText.trim()}
                  onClick={handleAiParse}
                  className="rounded-lg bg-blue-700 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-blue-800 disabled:opacity-50 cursor-pointer"
                >
                  {aiLoading ? 'Menganalisis pesan...' : 'Proses ke Formulir'}
                </button>
              </div>
            </div>
          )}

          {/* Section 1: Data Pelanggan & Instansi */}
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-slate-900 border-b border-slate-100 pb-2">
              1. Identitas Pelanggan &amp; Tier Harga
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Pilih Pelanggan Tersimpan (Opsional)
                </label>
                <select
                  value={selectedCustomerId}
                  onChange={(e) => handleSelectExistingCustomer(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white focus:border-blue-600 focus:outline-none"
                >
                  <option value="">-- Pelanggan Baru / Ketik Manual --</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nama_pelanggan} ({c.instansi}) · {KATEGORI_PELANGGAN_LABEL[c.kategori]}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-medium text-slate-700">Instansi / Perusahaan</label>
                  <button
                    type="button"
                    onClick={() => setShowNewInstansi((v) => !v)}
                    className="text-xs font-medium text-blue-700 hover:underline cursor-pointer"
                  >
                    + Instansi Baru
                  </button>
                </div>
                {showNewInstansi ? (
                  <div className="space-y-2">
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={newInstansiName}
                        onChange={(e) => setNewInstansiName(e.target.value)}
                        placeholder="Nama instansi baru..."
                        className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-600 focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={handleAddInstansi}
                        className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800 cursor-pointer"
                      >
                        Simpan
                      </button>
                    </div>
                    <input
                      type="date"
                      value={newInstansiPajak}
                      onChange={(e) => setNewInstansiPajak(e.target.value)}
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-600"
                      title="Tanggal berlaku pajak reklame (opsional)"
                    />
                    <p className="text-[11px] text-slate-500">
                      Tanggal pajak reklame opsional; bisa diubah kemudian di Integrasi &amp; Pemeliharaan.
                    </p>
                  </div>
                ) : (
                  <select
                    value={instansiId}
                    onChange={(e) => setInstansiId(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white focus:border-blue-600 focus:outline-none"
                  >
                    {instansis.map((i) => (
                      <option key={i.id} value={i.id}>
                        {i.nama_instansi}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Nama Pelanggan / PIC *
                </label>
                <input
                  type="text"
                  required
                  value={namaPelanggan}
                  onChange={(e) => setNamaPelanggan(e.target.value)}
                  placeholder="Contoh: Ibu Kartika Sari"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-600 focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    No. WhatsApp *
                  </label>
                  <input
                    type="text"
                    required
                    value={noWa}
                    onChange={(e) => setNoWa(e.target.value)}
                    placeholder="0812..."
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono focus:border-blue-600 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Kategori Harga
                  </label>
                  <select
                    value={kategori}
                    onChange={(e) => setKategori(e.target.value as CustomerCategory)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white focus:border-blue-600 focus:outline-none"
                  >
                    <option value="umum">Umum</option>
                    <option value="reseller">Reseller</option>
                    <option value="prioritas">Prioritas</option>
                    <option value="pegawai">Pegawai</option>
                  </select>
                </div>
              </div>
            </div>
          </div>

          {/* Section 2: Rincian Item Cetak */}
          <div className="space-y-3">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2">
              <h3 className="text-sm font-semibold text-slate-900">2. Rincian Item Cetak</h3>
              <button
                type="button"
                onClick={addItemRow}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
              >
                <Plus className="h-3.5 w-3.5" />
                Tambah Baris
              </button>
            </div>

            <div className="space-y-3">
              {items.map((row, idx) => {
                const calc = calculated.rows[idx];
                return (
                  <div
                    key={row.key}
                    className="rounded-lg border border-slate-200 bg-slate-50/70 p-3.5 space-y-3"
                  >
                    <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
                      <div className="sm:col-span-4">
                        <label className="block text-xs font-medium text-slate-700 mb-1">
                          Produk / Bahan *
                        </label>
                        <select
                          value={row.product_id}
                          onChange={(e) => updateRow(row.key, { product_id: Number(e.target.value) })}
                          className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-sm focus:border-blue-600 focus:outline-none"
                        >
                          {products.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.nama_produk} (
                              {p.kategori_produk === 'meteran'
                                ? 'm²'
                                : p.satuan_hitung === 'klik'
                                  ? 'klik'
                                  : 'pcs'}
                              )
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="sm:col-span-5">
                        <label className="block text-xs font-medium text-slate-700 mb-1">
                          Judul / Nama Item (untuk Desainer)
                        </label>
                        <input
                          type="text"
                          value={row.nama_item}
                          onChange={(e) => updateRow(row.key, { nama_item: e.target.value })}
                          placeholder="Misal: Spanduk Panggung Utama"
                          className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-sm focus:border-blue-600 focus:outline-none"
                        />
                      </div>

                      <div className="sm:col-span-2">
                        <label className="block text-xs font-medium text-slate-700 mb-1">Qty *</label>
                        <input
                          type="number"
                          min={1}
                          required
                          value={row.qty}
                          onChange={(e) => updateRow(row.key, { qty: e.target.value })}
                          className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-sm font-mono tabular-nums focus:border-blue-600 focus:outline-none"
                        />
                      </div>

                      <div className="sm:col-span-1 flex justify-end">
                        <button
                          type="button"
                          disabled={items.length <= 1}
                          onClick={() => removeItemRow(row.key)}
                          className="p-2 rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-30 cursor-pointer"
                          aria-label="Hapus baris"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>

                    {calc?.isMeteran && (
                      <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-center">
                        <div className="sm:col-span-3">
                          <label className="block text-xs font-medium text-slate-700 mb-1">
                            Lebar (m) *
                          </label>
                          <input
                            type="number"
                            step="0.01"
                            min="0.1"
                            required
                            value={row.lebar_m}
                            onChange={(e) => updateRow(row.key, { lebar_m: e.target.value })}
                            className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm font-mono tabular-nums"
                          />
                        </div>
                        <div className="sm:col-span-3">
                          <label className="block text-xs font-medium text-slate-700 mb-1">
                            Tinggi (m) *
                          </label>
                          <input
                            type="number"
                            step="0.01"
                            min="0.1"
                            required
                            value={row.tinggi_m}
                            onChange={(e) => updateRow(row.key, { tinggi_m: e.target.value })}
                            className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm font-mono tabular-nums"
                          />
                        </div>
                        <div className="sm:col-span-6">
                          <label className="block text-xs font-medium text-slate-700 mb-1">
                            Finishing (Ekstra Bahan Internal)
                          </label>
                          <select
                            value={row.finishing_id}
                            onChange={(e) => updateRow(row.key, { finishing_id: e.target.value })}
                            className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm"
                          >
                            <option value="">Tanpa Finishing (Potong Pas)</option>
                            {finishings.map((f) => (
                              <option key={f.id} value={f.id}>
                                {f.nama_finishing}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                    )}

                    <div className="flex flex-wrap items-center justify-between gap-3 pt-1 text-xs text-slate-600">
                      <span>
                        Harga Tier ({KATEGORI_PELANGGAN_LABEL[kategori]}):{' '}
                        <strong className="font-mono tabular-nums text-slate-900">
                          {formatRupiah(calc?.harga)}
                        </strong>
                        {calc?.isMeteran
                          ? ` / m² · Luas Tagihan: ${formatDesimal(calc.luas)} m²`
                          : calc?.prod?.satuan_hitung === 'klik'
                            ? ` / klik · ${calc.qty} lembar × ${calc.prod.klik_per_lembar ?? 1} = ${calc.qty * (calc.prod.klik_per_lembar ?? 1)} klik`
                            : ' / pcs'}
                      </span>
                      <div className="flex flex-wrap items-center gap-3">
                        <label className="inline-flex items-center gap-1.5 text-slate-600">
                          Diskon item
                          <input
                            type="number"
                            min={0}
                            max={100}
                            step="0.5"
                            value={row.diskon_persen}
                            onChange={(e) => updateRow(row.key, { diskon_persen: e.target.value })}
                            className="w-16 rounded-md border border-slate-300 bg-white px-1.5 py-1 text-right font-mono"
                          />
                          %
                        </label>
                        {Number(row.diskon_persen) > 0 && (
                          <span className="text-rose-600 font-mono">
                            −{formatRupiah(calc?.diskonNominal)}
                          </span>
                        )}
                        <span className="font-mono tabular-nums font-semibold text-slate-900">
                          Subtotal: {formatRupiah(calc?.subtotal)}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Section 3: Pembayaran & Briefing Desain */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-slate-900 border-b border-slate-100 pb-2">
                3. Pembayaran &amp; Deadline
              </h3>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3.5 space-y-1.5">
                <div className="flex items-center justify-between text-xs text-slate-600">
                  <span>Subtotal item</span>
                  <span className="font-mono">{formatRupiah(calculated.totalSebelumDiskon)}</span>
                </div>
                <div className="flex items-center justify-between text-xs text-slate-600">
                  <span>Diskon nota ({calculated.diskonNotaPersen}%)</span>
                  <span className="font-mono text-rose-600">−{formatRupiah(calculated.diskonNotaNominal)}</span>
                </div>
                <div className="flex items-center justify-between text-xs text-slate-600">
                  <span>DPP</span>
                  <span className="font-mono">{formatRupiah(calculated.dpp)}</span>
                </div>
                {calculated.effectivePpn > 0 && (
                  <div className="flex items-center justify-between text-xs text-slate-600">
                    <span>PPN {calculated.effectivePpn}%</span>
                    <span className="font-mono">+{formatRupiah(calculated.ppnNominal)}</span>
                  </div>
                )}
                {calculated.effectivePph > 0 && (
                  <div className="flex items-center justify-between text-xs text-slate-600">
                    <span>PPh 23 {calculated.effectivePph}% (dipotong klien)</span>
                    <span className="font-mono text-rose-600">−{formatRupiah(calculated.pphNominal)}</span>
                  </div>
                )}
                <div className="flex items-center justify-between border-t border-slate-200 pt-2">
                  <span className="text-xs font-medium text-slate-600">Total Tagihan Nota</span>
                  <span className="font-mono tabular-nums text-lg font-bold text-slate-900">
                    {formatRupiah(calculated.total)}
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <label className="text-xs font-medium text-slate-700">
                  Diskon Nota (%)
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step="0.5"
                    value={diskonNota}
                    onChange={(e) => setDiskonNota(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-2 text-sm font-mono"
                  />
                </label>
                <label className="text-xs font-medium text-slate-700">
                  PPN (%)
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step="0.5"
                    value={ppnPersen}
                    onChange={(e) => setPpnPersen(e.target.value)}
                    placeholder={`Otomatis: ${calculated.selectedInst?.is_pkp ? Number(calculated.selectedInst?.ppn_persen ?? 11) : Number(calculated.selectedInst?.ppn_persen ?? 0)}`}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-2 text-sm font-mono"
                  />
                </label>
                <label className="text-xs font-medium text-slate-700">
                  PPh 23 (%)
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step="0.5"
                    value={pph23Persen}
                    onChange={(e) => setPph23Persen(e.target.value)}
                    placeholder={`Otomatis: ${Number(calculated.selectedInst?.pph23_persen ?? 0)}`}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-2 text-sm font-mono"
                  />
                </label>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Status Bayar</label>
                  <select
                    value={statusBayar}
                    onChange={(e) => setStatusBayar(e.target.value as PaymentStatus)}
                    className="w-full rounded-lg border border-slate-300 px-2.5 py-2 text-sm bg-white"
                  >
                    <option value="belum_lunas">Belum Lunas</option>
                    <option value="dp">DP (Uang Muka)</option>
                    <option value="lunas">Lunas</option>
                  </select>
                </div>
                {statusBayar === 'dp' && (
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Nominal DP (Rp) *
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={calculated.total}
                      required
                      value={jumlahDp}
                      onChange={(e) => setJumlahDp(e.target.value)}
                      className="w-full rounded-lg border border-slate-300 px-2.5 py-2 text-sm font-mono tabular-nums"
                      placeholder="0"
                    />
                  </div>
                )}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Target Deadline Produksi
                  </label>
                  <input
                    type="datetime-local"
                    value={deadline}
                    onChange={(e) => setDeadline(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-2.5 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Jatuh Tempo Pembayaran
                  </label>
                  <input
                    type="date"
                    value={jatuhTempo}
                    onChange={(e) => setJatuhTempo(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-2.5 py-2 text-sm"
                  />
                </div>
              </div>

              {Number(calculated.selectedInst?.credit_limit ?? 0) > 0 && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                  <p>
                    Limit kredit instansi: <strong className="font-mono">{formatRupiah(calculated.selectedInst?.credit_limit)}</strong>.
                    Nota dengan status belum lunas akan dicek terhadap piutang aktif.
                  </p>
                  <label className="mt-2 flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={overrideCredit}
                      onChange={(e) => setOverrideCredit(e.target.checked)}
                      className="h-4 w-4 rounded border-amber-300 text-amber-600"
                    />
                    Override batas kredit (persetujuan Owner)
                  </label>
                </div>
              )}

              <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={selfAcc}
                  onChange={(e) => setSelfAcc(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-blue-600"
                />
                Buat link Self-ACC pelanggan (QR / WhatsApp)
              </label>
            </div>

            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-slate-900 border-b border-slate-100 pb-2">
                4. Briefing Desain &amp; Lampiran
              </h3>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Status File Awal</label>
                <select
                  value={statusDesain}
                  onChange={(e) => setStatusDesain(e.target.value as DesignStatus)}
                  className="w-full rounded-lg border border-slate-300 px-2.5 py-2 text-sm bg-white"
                >
                  {(Object.keys(STATUS_DESAIN_LABEL) as DesignStatus[]).map((k) => (
                    <option key={k} value={k}>
                      {STATUS_DESAIN_LABEL[k]}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Catatan Briefing untuk Desainer
                </label>
                <textarea
                  rows={2}
                  value={catatanDesain}
                  onChange={(e) => setCatatanDesain(e.target.value)}
                  placeholder="Instruksi warna, teks, logo, atau referensi..."
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Lampiran Briefing / Sketsa (Opsional)
                </label>
                <label className="flex items-center gap-2 rounded-lg border border-dashed border-slate-300 px-3 py-2 text-xs text-slate-600 hover:bg-slate-50 cursor-pointer">
                  <Upload className="h-4 w-4 text-slate-400 shrink-0" />
                  <span className="truncate">
                    {briefingFile ? briefingFile.name : 'Pilih file gambar / PDF / arsip...'}
                  </span>
                  <input
                    type="file"
                    className="hidden"
                    onChange={(e) => setBriefingFile(e.target.files?.[0] ?? null)}
                  />
                </label>
              </div>
            </div>
          </div>

          {/* Section 5: Optional SPK Advertising */}
          <div className="rounded-lg border border-slate-200 p-4 space-y-3">
            <label className="flex items-center gap-2.5 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={spkEnabled}
                onChange={(e) => setSpkEnabled(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="text-sm font-semibold text-slate-900">
                Sertakan SPK Lapangan Advertising (Non-Billing)
              </span>
            </label>

            {spkEnabled && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Jenis Pekerjaan Lapangan *
                  </label>
                  <input
                    type="text"
                    required={spkEnabled}
                    value={spkJenis}
                    onChange={(e) => setSpkJenis(e.target.value)}
                    placeholder="Contoh: Pemasangan Rangka Baliho"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Ukuran &amp; Spesifikasi Konstruksi *
                  </label>
                  <input
                    type="text"
                    required={spkEnabled}
                    value={spkUkuran}
                    onChange={(e) => setSpkUkuran(e.target.value)}
                    placeholder="Contoh: 4x6m Besi Hollow 4x4"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Lokasi Pemasangan *
                  </label>
                  <input
                    type="text"
                    required={spkEnabled}
                    value={spkLokasi}
                    onChange={(e) => setSpkLokasi(e.target.value)}
                    placeholder="Alamat / titik koordinat lokasi pasang..."
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Catatan Teknis Lapangan
                  </label>
                  <input
                    type="text"
                    value={spkCatatan}
                    onChange={(e) => setSpkCatatan(e.target.value)}
                    placeholder="Akses loading, jam kerja, perlengkapan keselamatan..."
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
              </div>
            )}
          </div>

          <div className="flex items-center justify-end gap-3 pt-2 border-t border-slate-200">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
            >
              Batal
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="rounded-lg bg-blue-700 px-5 py-2 text-sm font-semibold text-white hover:bg-blue-800 disabled:opacity-50 cursor-pointer"
            >
              {submitting ? 'Menyimpan Nota...' : 'Simpan Nota Order'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

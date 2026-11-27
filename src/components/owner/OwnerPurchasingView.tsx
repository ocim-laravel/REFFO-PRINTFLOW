import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Ban, Download, Eye, Pencil, Plus, RefreshCw, Truck, Wallet, X } from 'lucide-react';
import type {
  BootstrapPayload,
  GoodsReceipt,
  MaterialRoll,
  PaymentMethod,
  Product,
  PurchaseOrder,
  PurchaseOrderItemKind,
  Supplier,
  SupplierPayment,
  SupplyItem,
} from '../../types';
import { apiFetch, downloadAuthorized } from '../../lib/api';
import { formatRupiah, formatTanggalSingkat } from '../../lib/format';

interface OwnerPurchasingViewProps {
  onNotify: (type: 'success' | 'error', message: string) => void;
}

type SupplierRow = Supplier & { jumlah_po?: number; total_hutang?: number };

interface PoDraftItem {
  jenis: PurchaseOrderItemKind;
  referensi_id: number;
  qty: string;
  harga_satuan: string;
}

const STATUS_PO: Record<string, string> = {
  draft: 'Draft',
  dikirim: 'Dikirim',
  diterima: 'Diterima',
  batal: 'Batal',
};

const statusPoClass = (status: string) =>
  status === 'diterima'
    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
    : status === 'dikirim'
      ? 'bg-blue-50 text-blue-700 border-blue-200'
      : status === 'batal'
        ? 'bg-rose-50 text-rose-700 border-rose-200'
        : 'bg-slate-100 text-slate-600 border-slate-200';

export const OwnerPurchasingView: React.FC<OwnerPurchasingViewProps> = ({ onNotify }) => {
  const [tab, setTab] = useState<'po' | 'supplier' | 'hutang'>('po');
  const [suppliers, setSuppliers] = useState<SupplierRow[]>([]);
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [receipts, setReceipts] = useState<GoodsReceipt[]>([]);
  const [payments, setPayments] = useState<SupplierPayment[]>([]);
  const [bootstrap, setBootstrap] = useState<BootstrapPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [supplierForm, setSupplierForm] = useState(false);
  const [supplierEdit, setSupplierEdit] = useState<SupplierRow | null>(null);
  const [poForm, setPoForm] = useState(false);
  const [poEditId, setPoEditId] = useState<number | null>(null);
  const [detailPo, setDetailPo] = useState<{
    purchase_order: PurchaseOrder;
    goods_receipts: GoodsReceipt[];
    payments: SupplierPayment[];
  } | null>(null);
  const [bayarPo, setBayarPo] = useState<PurchaseOrder | null>(null);

  const [supplierInput, setSupplierInput] = useState({ kode_supplier: '', nama_supplier: '', kontak: '', no_wa: '', alamat: '', npwp: '', aktif: true });
  const [poInput, setPoInput] = useState({ supplier_id: 0, tanggal: new Date().toISOString().slice(0, 10), expected_at: '', catatan: '' });
  const [poItems, setPoItems] = useState<PoDraftItem[]>([{ jenis: 'supply', referensi_id: 0, qty: '1', harga_satuan: '0' }]);
  const [bayarInput, setBayarInput] = useState({ nominal: '', metode: 'Transfer' as PaymentMethod, keterangan: '' });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [sup, po, gr, pay, boot] = await Promise.all([
        apiFetch<{ suppliers: SupplierRow[] }>('/api/owner/suppliers'),
        apiFetch<{ purchase_orders: PurchaseOrder[] }>('/api/owner/purchase-orders'),
        apiFetch<{ goods_receipts: GoodsReceipt[] }>('/api/owner/goods-receipts'),
        apiFetch<{ payments: SupplierPayment[] }>('/api/owner/supplier-payments'),
        apiFetch<BootstrapPayload>('/api/bootstrap'),
      ]);
      setSuppliers(sup.suppliers);
      setPurchaseOrders(po.purchase_orders);
      setReceipts(gr.goods_receipts);
      setPayments(pay.payments);
      setBootstrap(boot);
      if (!poInput.supplier_id && sup.suppliers.length > 0) {
        setPoInput((prev) => ({ ...prev, supplier_id: sup.suppliers.find((s) => s.aktif)?.id ?? sup.suppliers[0]?.id ?? 0 }));
      }
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Gagal memuat data pembelian.');
    } finally {
      setLoading(false);
    }
  }, [onNotify, poInput.supplier_id]);

  useEffect(() => {
    load();
  }, [load]);

  const pilihanBarang = useMemo(() => {
    const rolls = bootstrap?.rolls ?? [];
    const supplies = bootstrap?.supplies ?? [];
    const products = bootstrap?.products ?? [];
    return { roll: rolls, supply: supplies, produk: products } as Record<PurchaseOrderItemKind, Array<MaterialRoll | SupplyItem | Product>>;
  }, [bootstrap]);

  const namaBarang = (jenis: PurchaseOrderItemKind, id: number) => {
    const row = pilihanBarang[jenis].find((b) => b.id === id);
    if (!row) return '-';
    if (jenis === 'roll') return `${(row as MaterialRoll).kode_roll} — ${(row as MaterialRoll).jenis_bahan}`;
    if (jenis === 'supply') return `${(row as SupplyItem).kode} — ${(row as SupplyItem).nama}`;
    return (row as Product).nama_produk;
  };

  const opsiUntuk = (jenis: PurchaseOrderItemKind) => pilihanBarang[jenis];

  const totalHutang = purchaseOrders
    .filter((po) => po.status === 'diterima')
    .reduce((sum, po) => sum + Math.max(0, po.total - (po.sudah_dibayar ?? 0)), 0);

  const openSupplierForm = (supplier?: SupplierRow) => {
    setSupplierEdit(supplier ?? null);
    setSupplierInput(
      supplier
        ? {
            kode_supplier: supplier.kode_supplier,
            nama_supplier: supplier.nama_supplier,
            kontak: supplier.kontak ?? '',
            no_wa: supplier.no_wa ?? '',
            alamat: supplier.alamat ?? '',
            npwp: supplier.npwp ?? '',
            aktif: supplier.aktif,
          }
        : { kode_supplier: '', nama_supplier: '', kontak: '', no_wa: '', alamat: '', npwp: '', aktif: true },
    );
    setSupplierForm(true);
  };

  const nonaktifSupplier = async (supplier: SupplierRow) => {
    if (!window.confirm(`Nonaktifkan supplier ${supplier.nama_supplier}?`)) return;
    try {
      await apiFetch(`/api/owner/suppliers/${supplier.id}/nonaktif`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      setSupplierEdit(null);
      onNotify('success', `Supplier ${supplier.nama_supplier} dinonaktifkan.`);
      await load();
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Gagal menonaktifkan supplier.');
    }
  };

  const submitSupplier = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiFetch(supplierEdit ? `/api/owner/suppliers/${supplierEdit.id}` : '/api/owner/suppliers', {
        method: supplierEdit ? 'PUT' : 'POST',
        body: JSON.stringify(supplierInput),
      });
      setSupplierForm(false);
      setSupplierEdit(null);
      setSupplierInput({ kode_supplier: '', nama_supplier: '', kontak: '', no_wa: '', alamat: '', npwp: '', aktif: true });
      onNotify('success', supplierEdit ? 'Supplier berhasil diperbarui.' : 'Supplier berhasil ditambahkan.');
      await load();
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Gagal menyimpan supplier.');
    }
  };

  const openPoDetail = async (po: PurchaseOrder) => {
    try {
      const res = await apiFetch<{
        purchase_order: PurchaseOrder;
        goods_receipts: GoodsReceipt[];
        payments: SupplierPayment[];
      }>(`/api/owner/purchase-orders/${po.id}`);
      setDetailPo(res);
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Gagal memuat detail PO.');
    }
  };

  const openPoForm = (po?: PurchaseOrder) => {
    setPoEditId(po?.id ?? null);
    setPoInput({
      supplier_id: po?.supplier_id ?? suppliers.find((s) => s.aktif)?.id ?? suppliers[0]?.id ?? 0,
      tanggal: po?.tanggal ?? new Date().toISOString().slice(0, 10),
      expected_at: po?.expected_at ?? '',
      catatan: po?.catatan ?? '',
    });
    setPoItems(
      po && po.items.length > 0
        ? po.items.map((item) => ({
            jenis: item.jenis,
            referensi_id: item.referensi_id,
            qty: String(item.qty),
            harga_satuan: String(item.harga_satuan),
          }))
        : [{ jenis: 'supply', referensi_id: 0, qty: '1', harga_satuan: '0' }],
    );
    setPoForm(true);
  };

  const submitPo = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiFetch(poEditId ? `/api/owner/purchase-orders/${poEditId}` : '/api/owner/purchase-orders', {
        method: poEditId ? 'PUT' : 'POST',
        body: JSON.stringify({ ...poInput, items: poItems }),
      });
      setPoForm(false);
      setPoEditId(null);
      setPoItems([{ jenis: 'supply', referensi_id: 0, qty: '1', harga_satuan: '0' }]);
      onNotify('success', poEditId ? 'Purchase order berhasil diperbarui.' : 'Purchase order berhasil dibuat.');
      await load();
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Gagal menyimpan purchase order.');
    }
  };

  const aksiPo = async (po: PurchaseOrder, aksi: 'kirim' | 'terima') => {
    try {
      await apiFetch(`/api/owner/purchase-orders/${po.id}/${aksi}`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      onNotify('success', `PO ${po.no_po} berhasil ${aksi === 'kirim' ? 'dikirim' : 'diterima'}.`);
      await load();
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Gagal memproses PO.');
    }
  };

  const submitBayar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!bayarPo) return;
    try {
      await apiFetch(`/api/owner/purchase-orders/${bayarPo.id}/bayar`, {
        method: 'POST',
        body: JSON.stringify({ nominal: Number(bayarInput.nominal), metode: bayarInput.metode, keterangan: bayarInput.keterangan }),
      });
      setBayarPo(null);
      setBayarInput({ nominal: '', metode: 'Transfer', keterangan: '' });
      onNotify('success', `Pembayaran PO ${bayarPo.no_po} berhasil dicatat.`);
      await load();
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Gagal mencatat pembayaran.');
    }
  };

  const unduh = async (type: string) => {
    const qs = new URLSearchParams({ type });
    try {
      await downloadAuthorized(`/api/owner/reports/export?${qs.toString()}`, `reffo-${type}.csv`);
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Gagal mengekspor data.');
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-semibold text-slate-900">Supplier & Purchase Order</h2>
          <p className="text-sm text-slate-500">Kelola supplier, PO, penerimaan barang, dan hutang dagang.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => load()} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer">
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            Segarkan
          </button>
          <button type="button" onClick={() => unduh('po')} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer">
            <Download className="h-3.5 w-3.5" />
            Ekspor PO
          </button>
          <button type="button" onClick={() => unduh('supplier')} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer">
            <Download className="h-3.5 w-3.5" />
            Ekspor Supplier
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs text-slate-500">Total PO</p>
          <p className="mt-1 font-mono text-xl font-semibold text-slate-900">{purchaseOrders.length}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs text-slate-500">Supplier Aktif</p>
          <p className="mt-1 font-mono text-xl font-semibold text-slate-900">{suppliers.filter((s) => s.aktif).length}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs text-slate-500">Hutang Dagang</p>
          <p className="mt-1 font-mono text-xl font-semibold text-rose-700">{formatRupiah(totalHutang)}</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {([
          ['po', 'Purchase Order'],
          ['supplier', 'Supplier'],
          ['hutang', 'Penerimaan & Pembayaran'],
        ] as const).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`rounded-lg px-3.5 py-2 text-xs font-semibold cursor-pointer ${tab === key ? 'bg-slate-900 text-white' : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'po' && (
        <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
            <h3 className="font-semibold text-slate-900 text-sm">Daftar Purchase Order</h3>
            <button type="button" onClick={() => openPoForm()} className="inline-flex items-center gap-1.5 rounded-lg bg-blue-700 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-800 cursor-pointer">
              <Plus className="h-3.5 w-3.5" />
              Buat PO
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm responsive-table">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-2.5 text-left">No PO</th>
                  <th className="px-4 py-2.5 text-left">Supplier</th>
                  <th className="px-4 py-2.5 text-left">Tanggal</th>
                  <th className="px-4 py-2.5 text-right">Total</th>
                  <th className="px-4 py-2.5 text-right">Sisa Hutang</th>
                  <th className="px-4 py-2.5 text-left">Status</th>
                  <th className="px-4 py-2.5 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {purchaseOrders.map((po) => (
                  <tr key={po.id} className="hover:bg-slate-50">
                    <td className="px-4 py-2.5 font-mono text-xs text-slate-800">{po.no_po}</td>
                    <td className="px-4 py-2.5 text-slate-700">{po.supplier_name ?? '-'}</td>
                    <td className="px-4 py-2.5 text-slate-600">{formatTanggalSingkat(po.tanggal)}</td>
                    <td className="px-4 py-2.5 text-right font-mono">{formatRupiah(po.total)}</td>
                    <td className="px-4 py-2.5 text-right font-mono font-semibold text-rose-700">
                      {formatRupiah(Math.max(0, po.total - (po.sudah_dibayar ?? 0)))}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={`inline-block rounded-md border px-2 py-0.5 text-[11px] font-semibold ${statusPoClass(po.status)}`}>
                        {STATUS_PO[po.status] ?? po.status}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <div className="inline-flex flex-wrap justify-end gap-1.5">
                        <button type="button" onClick={() => openPoDetail(po)} className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-2.5 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-50 cursor-pointer">
                          <Eye className="h-3 w-3" />
                          Detail
                        </button>
                        {po.status === 'draft' && (
                          <button type="button" onClick={() => openPoForm(po)} className="inline-flex items-center gap-1 rounded-md border border-blue-300 bg-blue-50 px-2.5 py-1 text-[11px] font-semibold text-blue-700 hover:bg-blue-100 cursor-pointer">
                            <Pencil className="h-3 w-3" />
                            Edit
                          </button>
                        )}
                        {po.status === 'draft' && (
                          <button type="button" onClick={() => aksiPo(po, 'kirim')} className="rounded-md bg-blue-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-blue-700 cursor-pointer">
                            Kirim
                          </button>
                        )}
                        {po.status === 'dikirim' && (
                          <button type="button" onClick={() => aksiPo(po, 'terima')} className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-emerald-700 cursor-pointer">
                            <Truck className="h-3 w-3" />
                            Terima
                          </button>
                        )}
                        {po.status === 'diterima' && Math.max(0, po.total - (po.sudah_dibayar ?? 0)) > 0 && (
                          <button type="button" onClick={() => setBayarPo(po)} className="inline-flex items-center gap-1 rounded-md border border-emerald-300 bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700 hover:bg-emerald-100 cursor-pointer">
                            <Wallet className="h-3 w-3" />
                            Bayar
                          </button>
                        )}
                        <details className="relative">
                          <summary className="cursor-pointer rounded-md border border-slate-300 px-2.5 py-1 text-[11px] font-semibold text-slate-600">Item</summary>
                          <div className="absolute right-0 z-10 mt-1 w-72 rounded-lg border border-slate-200 bg-white p-2 text-left text-xs shadow-lg">
                            {po.items.map((item) => (
                              <p key={item.id} className="flex justify-between gap-2 border-b border-slate-100 py-1 last:border-0">
                                <span>{item.nama_barang}</span>
                                <span className="font-mono">{item.qty} {item.satuan} × {formatRupiah(item.harga_satuan)}</span>
                              </p>
                            ))}
                          </div>
                        </details>
                      </div>
                    </td>
                  </tr>
                ))}
                {purchaseOrders.length === 0 && (
                  <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-500">Belum ada purchase order.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'supplier' && (
        <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
            <h3 className="font-semibold text-slate-900 text-sm">Daftar Supplier</h3>
            <button type="button" onClick={() => openSupplierForm()} className="inline-flex items-center gap-1.5 rounded-lg bg-blue-700 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-800 cursor-pointer">
              <Plus className="h-3.5 w-3.5" />
              Tambah Supplier
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm responsive-table">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-2.5 text-left">Kode</th>
                  <th className="px-4 py-2.5 text-left">Nama</th>
                  <th className="px-4 py-2.5 text-left">Kontak</th>
                  <th className="px-4 py-2.5 text-left">No WA</th>
                  <th className="px-4 py-2.5 text-right">Hutang</th>
                  <th className="px-4 py-2.5 text-left">Status</th>
                  <th className="px-4 py-2.5 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {suppliers.map((s) => (
                  <tr key={s.id} className="hover:bg-slate-50">
                    <td className="px-4 py-2.5 font-mono text-xs text-slate-800">{s.kode_supplier}</td>
                    <td className="px-4 py-2.5 text-slate-700">{s.nama_supplier}</td>
                    <td className="px-4 py-2.5 text-slate-600">{s.kontak ?? '-'}</td>
                    <td className="px-4 py-2.5 font-mono text-slate-600">{s.no_wa ?? '-'}</td>
                    <td className="px-4 py-2.5 text-right font-mono">{formatRupiah(s.total_hutang ?? 0)}</td>
                    <td className="px-4 py-2.5 text-xs text-slate-600">{s.aktif ? 'Aktif' : 'Nonaktif'}</td>
                    <td className="px-4 py-2.5 text-right">
                      <div className="inline-flex flex-wrap justify-end gap-1.5">
                        <button type="button" onClick={() => openSupplierForm(s)} className="inline-flex items-center gap-1 rounded-md border border-blue-300 bg-blue-50 px-2.5 py-1 text-[11px] font-semibold text-blue-700 hover:bg-blue-100 cursor-pointer">
                          <Pencil className="h-3 w-3" />
                          Edit
                        </button>
                        {s.aktif && (
                          <button type="button" onClick={() => nonaktifSupplier(s)} className="inline-flex items-center gap-1 rounded-md border border-rose-300 bg-rose-50 px-2.5 py-1 text-[11px] font-semibold text-rose-700 hover:bg-rose-100 cursor-pointer">
                            <Ban className="h-3 w-3" />
                            Nonaktifkan
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'hutang' && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100">
              <h3 className="font-semibold text-slate-900 text-sm">Penerimaan Barang</h3>
            </div>
            <div className="overflow-x-auto max-h-80">
              <table className="min-w-full text-xs">
                <thead className="bg-slate-50 text-slate-500">
                  <tr><th className="px-3 py-2 text-left">No PO</th><th className="px-3 py-2 text-left">Tanggal</th><th className="px-3 py-2 text-left">Admin</th></tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {receipts.map((gr) => (
                    <tr key={gr.id}><td className="px-3 py-2 font-mono">{gr.no_po}</td><td className="px-3 py-2">{formatTanggalSingkat(gr.tanggal)}</td><td className="px-3 py-2">{gr.admin_name ?? '-'}</td></tr>
                  ))}
                  {receipts.length === 0 && <tr><td colSpan={3} className="px-3 py-6 text-center text-slate-500">Belum ada penerimaan.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100">
              <h3 className="font-semibold text-slate-900 text-sm">Pembayaran Supplier</h3>
            </div>
            <div className="overflow-x-auto max-h-80">
              <table className="min-w-full text-xs">
                <thead className="bg-slate-50 text-slate-500">
                  <tr><th className="px-3 py-2 text-left">No PO</th><th className="px-3 py-2 text-left">Supplier</th><th className="px-3 py-2 text-right">Nominal</th><th className="px-3 py-2 text-left">Metode</th></tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {payments.map((p) => (
                    <tr key={p.id}>
                      <td className="px-3 py-2 font-mono">{p.no_po ?? '-'}</td>
                      <td className="px-3 py-2">{p.supplier_name ?? '-'}</td>
                      <td className="px-3 py-2 text-right font-mono">{formatRupiah(p.nominal)}</td>
                      <td className="px-3 py-2">{p.metode}</td>
                    </tr>
                  ))}
                  {payments.length === 0 && <tr><td colSpan={4} className="px-3 py-6 text-center text-slate-500">Belum ada pembayaran.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {supplierForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <form onSubmit={submitSupplier} className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-base font-semibold text-slate-900">
                {supplierEdit ? `Edit Supplier ${supplierEdit.kode_supplier}` : 'Tambah Supplier'}
              </h3>
              <button type="button" onClick={() => { setSupplierForm(false); setSupplierEdit(null); }} className="text-slate-500 cursor-pointer"><X className="h-4 w-4" /></button>
            </div>
            {([
              ['kode_supplier', 'Kode Supplier'],
              ['nama_supplier', 'Nama Supplier *'],
              ['kontak', 'Kontak'],
              ['no_wa', 'No. WhatsApp'],
              ['alamat', 'Alamat'],
              ['npwp', 'NPWP'],
            ] as const).map(([field, label]) => (
              <div key={field}>
                <label className="block text-xs font-medium text-slate-700 mb-1">{label}</label>
                <input
                  required={field === 'nama_supplier'}
                  value={supplierInput[field]}
                  onChange={(e) => setSupplierInput((prev) => ({ ...prev, [field]: e.target.value }))}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
            ))}
            <label className="flex items-center gap-2 text-xs font-medium text-slate-700">
              <input
                type="checkbox"
                checked={supplierInput.aktif}
                onChange={(e) => setSupplierInput((prev) => ({ ...prev, aktif: e.target.checked }))}
                className="h-4 w-4"
              />
              Supplier aktif
            </label>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => { setSupplierForm(false); setSupplierEdit(null); }} className="rounded-lg border border-slate-300 px-3.5 py-2 text-xs font-medium text-slate-700 cursor-pointer">Batal</button>
              <button type="submit" className="rounded-lg bg-blue-700 px-4 py-2 text-xs font-semibold text-white cursor-pointer">Simpan</button>
            </div>
          </form>
        </div>
      )}

      {poForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <form onSubmit={submitPo} className="w-full max-w-2xl rounded-xl border border-slate-200 bg-white p-6 space-y-3 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-base font-semibold text-slate-900">
                {poEditId ? 'Edit Purchase Order Draft' : 'Buat Purchase Order'}
              </h3>
              <button type="button" onClick={() => { setPoForm(false); setPoEditId(null); }} className="text-slate-500 cursor-pointer"><X className="h-4 w-4" /></button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <label className="text-xs font-medium text-slate-700">Supplier *
                <select required value={poInput.supplier_id} onChange={(e) => setPoInput((prev) => ({ ...prev, supplier_id: Number(e.target.value) }))} className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-2 text-sm">
                  {suppliers
                    .filter((s) => s.aktif || s.id === poInput.supplier_id)
                    .map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.nama_supplier}{s.aktif ? '' : ' (Nonaktif)'}
                      </option>
                    ))}
                </select>
              </label>
              <label className="text-xs font-medium text-slate-700">Tanggal
                <input type="date" value={poInput.tanggal} onChange={(e) => setPoInput((prev) => ({ ...prev, tanggal: e.target.value }))} className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-2 text-sm" />
              </label>
              <label className="text-xs font-medium text-slate-700">Estimasi Terima
                <input type="date" value={poInput.expected_at} onChange={(e) => setPoInput((prev) => ({ ...prev, expected_at: e.target.value }))} className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-2 text-sm" />
              </label>
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium text-slate-700">Barang PO</p>
                <button type="button" onClick={() => setPoItems((prev) => [...prev, { jenis: 'supply', referensi_id: 0, qty: '1', harga_satuan: '0' }])} className="inline-flex items-center gap-1 text-[11px] font-semibold text-blue-700 cursor-pointer">
                  <Plus className="h-3 w-3" />
                  Tambah Baris
                </button>
              </div>
              {poItems.map((item, idx) => (
                <div key={idx} className="grid grid-cols-12 gap-2 rounded-lg border border-slate-200 bg-slate-50 p-2">
                  <select
                    value={item.jenis}
                    onChange={(e) => setPoItems((prev) => prev.map((row, i) => (i === idx ? { ...row, jenis: e.target.value as PurchaseOrderItemKind, referensi_id: 0 } : row)))}
                    className="col-span-3 rounded-lg border border-slate-300 px-2 py-1.5 text-xs"
                  >
                    <option value="supply">Bahan Pembantu</option>
                    <option value="roll">Roll</option>
                    <option value="produk">Produk</option>
                  </select>
                  <select
                    required
                    value={item.referensi_id}
                    onChange={(e) => setPoItems((prev) => prev.map((row, i) => (i === idx ? { ...row, referensi_id: Number(e.target.value) } : row)))}
                    className="col-span-4 rounded-lg border border-slate-300 px-2 py-1.5 text-xs"
                  >
                    <option value={0}>- Pilih Barang -</option>
                    {opsiUntuk(item.jenis).map((barang) => <option key={barang.id} value={barang.id}>{namaBarang(item.jenis, barang.id)}</option>)}
                  </select>
                  <input required type="number" min="0.01" step="0.01" value={item.qty} onChange={(e) => setPoItems((prev) => prev.map((row, i) => (i === idx ? { ...row, qty: e.target.value } : row)))} placeholder="Qty" className="col-span-2 rounded-lg border border-slate-300 px-2 py-1.5 text-xs" />
                  <input required type="number" min="0" step="0.01" value={item.harga_satuan} onChange={(e) => setPoItems((prev) => prev.map((row, i) => (i === idx ? { ...row, harga_satuan: e.target.value } : row)))} placeholder="Harga" className="col-span-2 rounded-lg border border-slate-300 px-2 py-1.5 text-xs" />
                  <button type="button" onClick={() => setPoItems((prev) => prev.filter((_, i) => i !== idx))} className="col-span-1 text-slate-500 hover:text-rose-700 cursor-pointer"><X className="h-3.5 w-3.5" /></button>
                </div>
              ))}
            </div>
            <label className="block text-xs font-medium text-slate-700">Catatan
              <input value={poInput.catatan} onChange={(e) => setPoInput((prev) => ({ ...prev, catatan: e.target.value }))} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            </label>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => { setPoForm(false); setPoEditId(null); }} className="rounded-lg border border-slate-300 px-3.5 py-2 text-xs font-medium text-slate-700 cursor-pointer">Batal</button>
              <button type="submit" className="rounded-lg bg-blue-700 px-4 py-2 text-xs font-semibold text-white cursor-pointer">Simpan PO</button>
            </div>
          </form>
        </div>
      )}

      {bayarPo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <form onSubmit={submitBayar} className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-6 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-base font-semibold text-slate-900">Bayar {bayarPo.no_po}</h3>
              <button type="button" onClick={() => setBayarPo(null)} className="text-slate-500 cursor-pointer"><X className="h-4 w-4" /></button>
            </div>
            <p className="text-xs text-slate-500">Sisa hutang: {formatRupiah(Math.max(0, bayarPo.total - (bayarPo.sudah_dibayar ?? 0)))}</p>
            <label className="block text-xs font-medium text-slate-700">Nominal *
              <input required type="number" min="1" step="0.01" value={bayarInput.nominal} onChange={(e) => setBayarInput((prev) => ({ ...prev, nominal: e.target.value }))} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            </label>
            <label className="block text-xs font-medium text-slate-700">Metode
              <select value={bayarInput.metode} onChange={(e) => setBayarInput((prev) => ({ ...prev, metode: e.target.value as PaymentMethod }))} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
                <option value="Tunai">Tunai</option>
                <option value="Transfer">Transfer</option>
                <option value="QRIS">QRIS</option>
              </select>
            </label>
            <label className="block text-xs font-medium text-slate-700">Keterangan
              <input value={bayarInput.keterangan} onChange={(e) => setBayarInput((prev) => ({ ...prev, keterangan: e.target.value }))} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            </label>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setBayarPo(null)} className="rounded-lg border border-slate-300 px-3.5 py-2 text-xs font-medium text-slate-700 cursor-pointer">Batal</button>
              <button type="submit" className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white cursor-pointer">Catat Pembayaran</button>
            </div>
          </form>
        </div>
      )}

      {detailPo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <div className="w-full max-w-2xl rounded-xl border border-slate-200 bg-white p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="font-display text-base font-semibold text-slate-900">
                  Detail PO {detailPo.purchase_order.no_po}
                </h3>
                <p className="mt-0.5 text-xs text-slate-500">
                  {detailPo.purchase_order.supplier_name ?? '-'} ·{' '}
                  {formatTanggalSingkat(detailPo.purchase_order.tanggal)}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className={`inline-block rounded-md border px-2 py-0.5 text-[11px] font-semibold ${statusPoClass(detailPo.purchase_order.status)}`}>
                  {STATUS_PO[detailPo.purchase_order.status] ?? detailPo.purchase_order.status}
                </span>
                <button type="button" onClick={() => setDetailPo(null)} className="text-slate-500 cursor-pointer"><X className="h-4 w-4" /></button>
              </div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
              <div className="rounded-lg bg-slate-50 p-2"><p className="text-slate-500">Total</p><p className="font-mono font-semibold text-slate-900">{formatRupiah(detailPo.purchase_order.total)}</p></div>
              <div className="rounded-lg bg-slate-50 p-2"><p className="text-slate-500">Sudah Dibayar</p><p className="font-mono font-semibold text-emerald-700">{formatRupiah(detailPo.purchase_order.sudah_dibayar)}</p></div>
              <div className="rounded-lg bg-slate-50 p-2"><p className="text-slate-500">Sisa Hutang</p><p className="font-mono font-semibold text-rose-700">{formatRupiah(Math.max(0, detailPo.purchase_order.total - detailPo.purchase_order.sudah_dibayar))}</p></div>
              <div className="rounded-lg bg-slate-50 p-2"><p className="text-slate-500">Estimasi Terima</p><p className="font-medium text-slate-800">{detailPo.purchase_order.expected_at ? formatTanggalSingkat(detailPo.purchase_order.expected_at) : '-'}</p></div>
            </div>
            {detailPo.purchase_order.catatan && (
              <p className="rounded-lg border border-slate-200 p-2 text-xs text-slate-600">
                Catatan: {detailPo.purchase_order.catatan}
              </p>
            )}
            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 text-slate-500">
                  <tr><th className="px-3 py-2 text-left">Barang</th><th className="px-3 py-2 text-right">Qty</th><th className="px-3 py-2 text-right">Harga</th><th className="px-3 py-2 text-right">Subtotal</th></tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {detailPo.purchase_order.items.map((item) => (
                    <tr key={item.id}>
                      <td className="px-3 py-2 text-slate-800">{item.nama_barang}</td>
                      <td className="px-3 py-2 text-right font-mono">{item.qty} {item.satuan}</td>
                      <td className="px-3 py-2 text-right font-mono">{formatRupiah(item.harga_satuan)}</td>
                      <td className="px-3 py-2 text-right font-mono">{formatRupiah(item.subtotal)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div className="rounded-lg border border-slate-200 p-3">
                <p className="font-semibold text-slate-800">Penerimaan</p>
                {detailPo.goods_receipts.length === 0 ? (
                  <p className="mt-1 text-slate-500">Belum ada penerimaan.</p>
                ) : (
                  detailPo.goods_receipts.map((gr) => (
                    <p key={gr.id} className="mt-1 text-slate-600">{gr.no_po} · {formatTanggalSingkat(gr.tanggal)}</p>
                  ))
                )}
              </div>
              <div className="rounded-lg border border-slate-200 p-3">
                <p className="font-semibold text-slate-800">Pembayaran</p>
                {detailPo.payments.length === 0 ? (
                  <p className="mt-1 text-slate-500">Belum ada pembayaran.</p>
                ) : (
                  detailPo.payments.map((p) => (
                    <p key={p.id} className="mt-1 flex justify-between gap-2 text-slate-600">
                      <span>{p.metode}</span>
                      <span className="font-mono">{formatRupiah(p.nominal)}</span>
                    </p>
                  ))
                )}
              </div>
            </div>
            <div className="flex justify-end pt-2">
              <button type="button" onClick={() => setDetailPo(null)} className="rounded-lg border border-slate-300 px-3.5 py-2 text-xs font-medium text-slate-700 cursor-pointer">Tutup</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

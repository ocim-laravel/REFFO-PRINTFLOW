import React, { useEffect, useState } from 'react';
import { Save, Plus } from 'lucide-react';
import type {
  Finishing,
  Instansi,
  MachineKind,
  PrintMachine,
  Product,
  SupplyCategory,
  SupplyItem,
  TaxPriceMode,
  TaxSettings,
} from '../../types';
import { apiFetch } from '../../lib/api';

interface OwnerSettingsViewProps {
  products: Product[];
  finishings: Finishing[];
  machines: PrintMachine[];
  supplies: SupplyItem[];
  instansis: Instansi[];
  taxSettings?: TaxSettings;
  onRefreshBootstrap: () => Promise<void>;
  onNotify: (type: 'success' | 'error', message: string) => void;
}

const MACHINE_KINDS: Array<{ value: MachineKind; label: string }> = [
  { value: 'large_format', label: 'Large Format' },
  { value: 'uv', label: 'UV Roll / Flatbed' },
  { value: 'digital_a3p', label: 'Digital Press A3+' },
  { value: 'cutting', label: 'Cutting Sticker / Laser' },
];

const SUPPLY_CATEGORIES: Array<{ value: SupplyCategory; label: string }> = [
  { value: 'tinta', label: 'Tinta / Toner' },
  { value: 'bahan_pembantu', label: 'Bahan Pembantu Finishing' },
  { value: 'suku_cadang', label: 'Suku Cadang' },
];

const NUMERIC_PRODUCT_FIELDS = new Set<keyof Product>([
  'harga_umum',
  'harga_reseller',
  'harga_prioritas',
  'harga_pegawai',
  'harga_modal',
  'klik_per_lembar',
]);

const ROLL_TYPES = [
  { label: 'MMT 280 (3.20 × 70 m)', value: 'MMT 280' },
  { label: 'MMT 340 (3.20 × 70 m)', value: 'MMT 340' },
  { label: 'MMT 440 (3.20 × 70 m)', value: 'MMT 440' },
  { label: 'Backlit (3.20 × 70 m)', value: 'Backlit' },
  { label: 'Stiker 1m (1.00 × 50 m)', value: 'Stiker 1m' },
  { label: 'Stiker 1.5m (1.50 × 50 m)', value: 'Stiker 1.5m' },
];

export const OwnerSettingsView: React.FC<OwnerSettingsViewProps> = ({
  products,
  finishings,
  machines,
  supplies,
  instansis,
  taxSettings,
  onRefreshBootstrap,
  onNotify,
}) => {
  const [productDrafts, setProductDrafts] = useState<Product[]>(products);
  const [finishingDrafts, setFinishingDrafts] = useState<Finishing[]>(finishings);
  const [machineDrafts, setMachineDrafts] = useState<PrintMachine[]>(machines);
  const [supplyDrafts, setSupplyDrafts] = useState<SupplyItem[]>(supplies);
  const [instansiDrafts, setInstansiDrafts] = useState<Instansi[]>(instansis);
  const [editingInstansi, setEditingInstansi] = useState<Instansi | null>(null);
  const [savingInstansi, setSavingInstansi] = useState(false);
  const [taxDraft, setTaxDraft] = useState<TaxSettings>({
    id: 1,
    ppn_persen_default: taxSettings?.ppn_persen_default ?? 11,
    pph23_persen_default: taxSettings?.pph23_persen_default ?? 2,
    mode_harga: taxSettings?.mode_harga ?? 'belum_termasuk_ppn',
    ppn_termasuk_diskon: taxSettings?.ppn_termasuk_diskon ?? true,
    potong_pph23_otomatis: taxSettings?.potong_pph23_otomatis ?? false,
    updated_at: taxSettings?.updated_at ?? null,
    updated_by: taxSettings?.updated_by ?? null,
  });
  const [savingTax, setSavingTax] = useState(false);

  const [newMachine, setNewMachine] = useState({
    kode_mesin: '',
    nama_mesin: '',
    jenis: 'large_format' as MachineKind,
    lebar_max_m: '',
    konsumsi_tinta_ml_per_m2: '0',
    keterangan: '',
  });
  const [newSupply, setNewSupply] = useState({
    kode: '',
    nama: '',
    kategori: 'tinta' as SupplyCategory,
    satuan: 'pcs',
    stok: '0',
    stok_minimum: '0',
    harga_satuan: '0',
    konsumsi_per_m2: '',
  });
  const [restockDrafts, setRestockDrafts] = useState<Record<number, string>>({});

  const [kodeRoll, setKodeRoll] = useState('');
  const [jenisBahan, setJenisBahan] = useState('MMT 280');

  const satuanProducts = products.filter((p) => p.kategori_produk === 'satuan');
  const [stokProductId, setStokProductId] = useState<string>(String(satuanProducts[0]?.id ?? ''));
  const [stokJumlah, setStokJumlah] = useState('10');

  const [savingProducts, setSavingProducts] = useState(false);
  const [savingFinishings, setSavingFinishings] = useState(false);
  const [savingMachines, setSavingMachines] = useState(false);
  const [savingSupplies, setSavingSupplies] = useState(false);
  const [restockBusy, setRestockBusy] = useState<number | null>(null);

  useEffect(() => {
    setProductDrafts(products);
  }, [products]);

  useEffect(() => {
    setFinishingDrafts(finishings);
  }, [finishings]);

  useEffect(() => {
    setMachineDrafts(machines);
  }, [machines]);

  useEffect(() => {
    setSupplyDrafts(supplies);
  }, [supplies]);

  useEffect(() => {
    setInstansiDrafts(instansis);
  }, [instansis]);

  useEffect(() => {
    if (taxSettings) {
      setTaxDraft(taxSettings);
    }
  }, [taxSettings]);

  const handleSaveTax = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingTax(true);
    try {
      await apiFetch('/api/owner/settings/tax', {
        method: 'PUT',
        body: JSON.stringify(taxDraft),
      });
      await onRefreshBootstrap();
      onNotify('success', 'Pengaturan pajak global berhasil disimpan.');
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Gagal menyimpan pengaturan pajak.');
    } finally {
      setSavingTax(false);
    }
  };

  const handleSaveInstansi = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingInstansi) return;
    setSavingInstansi(true);
    try {
      await apiFetch(`/api/instansis/${editingInstansi.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          nama_instansi: editingInstansi.nama_instansi,
          npwp: editingInstansi.npwp ?? '',
          is_pkp: Boolean(editingInstansi.is_pkp),
          ppn_persen: Number(editingInstansi.ppn_persen ?? 0),
          pph23_persen: Number(editingInstansi.pph23_persen ?? 0),
          tempo_hari: Number(editingInstansi.tempo_hari ?? 0),
          credit_limit: Number(editingInstansi.credit_limit ?? 0),
        }),
      });
      setEditingInstansi(null);
      await onRefreshBootstrap();
      onNotify('success', 'Pengaturan instansi (limit kredit & pajak) berhasil diperbarui.');
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Gagal menyimpan pengaturan instansi.');
    } finally {
      setSavingInstansi(false);
    }
  };

  const updateProductField = (id: number, field: keyof Product, val: string) => {
    setProductDrafts((prev) =>
      prev.map((p) =>
        p.id === id
          ? { ...p, [field]: NUMERIC_PRODUCT_FIELDS.has(field) ? Number(val) || 0 : val }
          : p,
      ),
    );
  };

  const updateProductMachine = (id: number, val: string) => {
    setProductDrafts((prev) =>
      prev.map((p) => (p.id === id ? { ...p, mesin_default_id: val ? Number(val) : null } : p)),
    );
  };

  const updateProductSatuan = (id: number, val: string) => {
    setProductDrafts((prev) =>
      prev.map((p) =>
        p.id === id
          ? {
              ...p,
              satuan_hitung: val === 'klik' ? 'klik' : 'pcs',
              klik_per_lembar: val === 'klik' ? (p.klik_per_lembar ?? 2) : 1,
            }
          : p,
      ),
    );
  };

  const updateFinishingField = (id: number, field: keyof Finishing, val: string) => {
    setFinishingDrafts((prev) =>
      prev.map((f) => (f.id === id ? { ...f, [field]: Number(val) || 0 } : f)),
    );
  };

  const handleSaveProducts = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingProducts(true);
    try {
      await apiFetch('/api/owner/settings/products', {
        method: 'PUT',
        body: JSON.stringify({ products: productDrafts }),
      });
      await onRefreshBootstrap();
      onNotify('success', 'Master harga 4 tier dan harga modal berhasil disimpan.');
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Gagal menyimpan harga produk.');
    } finally {
      setSavingProducts(false);
    }
  };

  const handleSaveFinishings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingFinishings(true);
    try {
      await apiFetch('/api/owner/settings/finishings', {
        method: 'PUT',
        body: JSON.stringify({ finishings: finishingDrafts }),
      });
      await onRefreshBootstrap();
      onNotify('success', 'Rumus ekstra bahan finishing berhasil diperbarui.');
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Gagal menyimpan finishing.');
    } finally {
      setSavingFinishings(false);
    }
  };

  const handleSaveMachines = async () => {
    setSavingMachines(true);
    try {
      for (const m of machineDrafts) {
        await apiFetch(`/api/owner/settings/machines/${m.id}`, {
          method: 'PUT',
          body: JSON.stringify(m),
        });
      }
      await onRefreshBootstrap();
      onNotify('success', 'Master mesin cetak berhasil diperbarui.');
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Gagal menyimpan master mesin.');
    } finally {
      setSavingMachines(false);
    }
  };

  const handleCreateMachine = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiFetch('/api/owner/settings/machines', {
        method: 'POST',
        body: JSON.stringify({
          ...newMachine,
          lebar_max_m: Number(newMachine.lebar_max_m) || null,
          konsumsi_tinta_ml_per_m2: Number(newMachine.konsumsi_tinta_ml_per_m2) || 0,
        }),
      });
      setNewMachine({
        kode_mesin: '',
        nama_mesin: '',
        jenis: 'large_format',
        lebar_max_m: '',
        konsumsi_tinta_ml_per_m2: '0',
        keterangan: '',
      });
      await onRefreshBootstrap();
      onNotify('success', 'Mesin cetak baru berhasil ditambahkan.');
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Gagal menambah mesin.');
    }
  };

  const handleSaveSupplies = async () => {
    setSavingSupplies(true);
    try {
      for (const s of supplyDrafts) {
        await apiFetch(`/api/owner/settings/supplies/${s.id}`, {
          method: 'PUT',
          body: JSON.stringify(s),
        });
      }
      await onRefreshBootstrap();
      onNotify('success', 'Master stok tinta & bahan pembantu berhasil diperbarui.');
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Gagal menyimpan master supply.');
    } finally {
      setSavingSupplies(false);
    }
  };

  const handleCreateSupply = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiFetch('/api/owner/settings/supplies', {
        method: 'POST',
        body: JSON.stringify({
          ...newSupply,
          stok: Number(newSupply.stok) || 0,
          stok_minimum: Number(newSupply.stok_minimum) || 0,
          harga_satuan: Number(newSupply.harga_satuan) || 0,
          konsumsi_per_m2: Number(newSupply.konsumsi_per_m2) || null,
        }),
      });
      setNewSupply({
        kode: '',
        nama: '',
        kategori: 'tinta',
        satuan: 'pcs',
        stok: '0',
        stok_minimum: '0',
        harga_satuan: '0',
        konsumsi_per_m2: '',
      });
      await onRefreshBootstrap();
      onNotify('success', 'Barang supply baru berhasil ditambahkan.');
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Gagal menambah supply.');
    }
  };

  const handleRestock = async (supply: SupplyItem) => {
    const jumlah = Number(restockDrafts[supply.id] ?? 0);
    if (!(jumlah > 0)) {
      onNotify('error', 'Jumlah restock wajib lebih dari 0.');
      return;
    }
    setRestockBusy(supply.id);
    try {
      await apiFetch(`/api/owner/settings/supplies/${supply.id}/restock`, {
        method: 'POST',
        body: JSON.stringify({ jumlah }),
      });
      setRestockDrafts((prev) => ({ ...prev, [supply.id]: '' }));
      await onRefreshBootstrap();
      onNotify('success', `Restock ${supply.nama} berhasil dicatat.`);
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Gagal melakukan restock.');
    } finally {
      setRestockBusy(null);
    }
  };

  const handleAddRoll = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiFetch('/api/owner/settings/rolls', {
        method: 'POST',
        body: JSON.stringify({ kode_roll: kodeRoll, jenis_bahan: jenisBahan }),
      });
      setKodeRoll('');
      await onRefreshBootstrap();
      onNotify('success', 'Stok roll baru berhasil ditambahkan.');
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Gagal menambah roll.');
    }
  };

  const handleAddStokPcs = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiFetch('/api/owner/settings/stok-pcs', {
        method: 'POST',
        body: JSON.stringify({
          product_id: Number(stokProductId),
          jumlah: Number(stokJumlah),
        }),
      });
      await onRefreshBootstrap();
      onNotify('success', 'Stok pcs produk satuan berhasil ditambah.');
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Gagal menambah stok pcs.');
    }
  };

  return (
    <div className="space-y-6">
      {/* Add Material Roll & Unit Stock */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <form
          onSubmit={handleAddRoll}
          className="bg-white rounded-xl border border-slate-200 p-5 space-y-4"
        >
          <div>
            <h2 className="font-display text-sm font-semibold text-slate-900">
              Tambah Stok Roll Bahan Baru
            </h2>
            <p className="text-xs text-slate-500">
              Lebar dan panjang standar mengikuti spesifikasi workshop.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Kode Roll *</label>
              <input
                type="text"
                required
                value={kodeRoll}
                onChange={(e) => setKodeRoll(e.target.value)}
                placeholder="Misal: MMT280-R03"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono uppercase"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Jenis Bahan</label>
              <select
                value={jenisBahan}
                onChange={(e) => setJenisBahan(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white"
              >
                {ROLL_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex justify-end">
            <button
              type="submit"
              className="inline-flex items-center gap-1.5 rounded-lg bg-blue-700 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-800 cursor-pointer"
            >
              <Plus className="h-3.5 w-3.5" />
              Tambah Roll Aktif
            </button>
          </div>
        </form>

        <form
          onSubmit={handleAddStokPcs}
          className="bg-white rounded-xl border border-slate-200 p-5 space-y-4"
        >
          <div>
            <h2 className="font-display text-sm font-semibold text-slate-900">
              Restock Produk Satuan (Pcs)
            </h2>
            <p className="text-xs text-slate-500">
              Menambah stok fisik rangka X-Banner, Roll Banner, atau A-Board.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Produk Satuan</label>
              <select
                value={stokProductId}
                onChange={(e) => setStokProductId(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white"
              >
                {satuanProducts.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nama_produk} (Sisa: {p.stok_pcs ?? 0} pcs)
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Jumlah Tambah *</label>
              <input
                type="number"
                min={1}
                required
                value={stokJumlah}
                onChange={(e) => setStokJumlah(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono tabular-nums"
              />
            </div>
          </div>
          <div className="flex justify-end">
            <button
              type="submit"
              className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 cursor-pointer"
            >
              <Plus className="h-3.5 w-3.5" />
              Tambah Stok Pcs
            </button>
          </div>
        </form>
      </div>

      {/* Master Mesin Cetak */}
      <form
        onSubmit={handleCreateMachine}
        className="bg-white rounded-xl border border-slate-200 p-5 space-y-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-sm font-semibold text-slate-900">
              Master Mesin Cetak &amp; Antrean
            </h2>
            <p className="text-xs text-slate-500">
              Menentukan mesin default produk, kapasitas lebar, dan konversi estimasi tinta.
            </p>
          </div>
          <button
            type="submit"
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-700 px-3.5 py-2 text-xs font-semibold text-white hover:bg-blue-800 cursor-pointer"
          >
            <Plus className="h-3.5 w-3.5" />
            Tambah Mesin
          </button>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Kode Mesin *</label>
            <input
              required
              value={newMachine.kode_mesin}
              onChange={(e) => setNewMachine({ ...newMachine, kode_mesin: e.target.value })}
              placeholder="LF-02"
              className="w-full rounded-lg border border-slate-300 px-2.5 py-2 text-sm font-mono uppercase"
            />
          </div>
          <div className="sm:col-span-2">
            <label className="block text-xs font-medium text-slate-700 mb-1">Nama Mesin *</label>
            <input
              required
              value={newMachine.nama_mesin}
              onChange={(e) => setNewMachine({ ...newMachine, nama_mesin: e.target.value })}
              placeholder=" Large Format Solvent"
              className="w-full rounded-lg border border-slate-300 px-2.5 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Jenis *</label>
            <select
              value={newMachine.jenis}
              onChange={(e) =>
                setNewMachine({ ...newMachine, jenis: e.target.value as MachineKind })
              }
              className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-sm"
            >
              {MACHINE_KINDS.map((k) => (
                <option key={k.value} value={k.value}>
                  {k.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Lebar Max (m)</label>
            <input
              type="number"
              step="0.001"
              min="0"
              value={newMachine.lebar_max_m}
              onChange={(e) => setNewMachine({ ...newMachine, lebar_max_m: e.target.value })}
              className="w-full rounded-lg border border-slate-300 px-2.5 py-2 text-sm font-mono tabular-nums"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Tinta ml/m²</label>
            <input
              type="number"
              step="0.5"
              min="0"
              value={newMachine.konsumsi_tinta_ml_per_m2}
              onChange={(e) =>
                setNewMachine({ ...newMachine, konsumsi_tinta_ml_per_m2: e.target.value })
              }
              className="w-full rounded-lg border border-slate-300 px-2.5 py-2 text-sm font-mono tabular-nums"
            />
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs sm:text-sm responsive-table">
            <thead className="bg-slate-50 border-y border-slate-200 text-xs font-semibold text-slate-600">
              <tr>
                <th className="text-left px-3 py-2.5">Kode</th>
                <th className="text-left px-3 py-2.5">Nama Mesin</th>
                <th className="text-left px-3 py-2.5">Jenis</th>
                <th className="text-right px-3 py-2.5">Lebar Max</th>
                <th className="text-right px-3 py-2.5">ml/m²</th>
                <th className="text-center px-3 py-2.5">Aktif</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {machineDrafts.map((m) => (
                <tr key={m.id}>
                  <td className="px-3 py-2 font-mono font-semibold text-slate-900">{m.kode_mesin}</td>
                  <td className="px-3 py-2">
                    <input
                      value={m.nama_mesin}
                      onChange={(e) =>
                        setMachineDrafts((prev) =>
                          prev.map((row) =>
                            row.id === m.id ? { ...row, nama_mesin: e.target.value } : row,
                          ),
                        )
                      }
                      className="w-full rounded-md border border-slate-300 px-2 py-1 text-xs"
                    />
                  </td>
                  <td className="px-3 py-2 text-slate-600">
                    {MACHINE_KINDS.find((k) => k.value === m.jenis)?.label ?? m.jenis}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <input
                      type="number"
                      step="0.001"
                      min="0"
                      value={m.lebar_max_m ?? ''}
                      onChange={(e) =>
                        setMachineDrafts((prev) =>
                          prev.map((row) =>
                            row.id === m.id
                              ? { ...row, lebar_max_m: Number(e.target.value) || null }
                              : row,
                          ),
                        )
                      }
                      className="w-20 rounded-md border border-slate-300 px-2 py-1 text-right font-mono text-xs"
                    />
                  </td>
                  <td className="px-3 py-2 text-right">
                    <input
                      type="number"
                      step="0.5"
                      min="0"
                      value={m.konsumsi_tinta_ml_per_m2}
                      onChange={(e) =>
                        setMachineDrafts((prev) =>
                          prev.map((row) =>
                            row.id === m.id
                              ? {
                                  ...row,
                                  konsumsi_tinta_ml_per_m2: Number(e.target.value) || 0,
                                }
                              : row,
                          ),
                        )
                      }
                      className="w-20 rounded-md border border-slate-300 px-2 py-1 text-right font-mono text-xs"
                    />
                  </td>
                  <td className="px-3 py-2 text-center">
                    <input
                      type="checkbox"
                      checked={m.aktif}
                      onChange={(e) =>
                        setMachineDrafts((prev) =>
                          prev.map((row) =>
                            row.id === m.id ? { ...row, aktif: e.target.checked } : row,
                          ),
                        )
                      }
                      className="h-4 w-4 accent-blue-700"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex justify-end">
          <button
            type="button"
            disabled={savingMachines}
            onClick={handleSaveMachines}
            className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50 cursor-pointer"
          >
            <Save className="h-3.5 w-3.5" />
            {savingMachines ? 'Menyimpan...' : 'Simpan Master Mesin'}
          </button>
        </div>
      </form>

      {/* Master Stok Tinta & Bahan Pembantu */}
      <form
        onSubmit={handleCreateSupply}
        className="bg-white rounded-xl border border-slate-200 p-5 space-y-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-sm font-semibold text-slate-900">
              Stok Tinta &amp; Bahan Pembantu Finishing
            </h2>
            <p className="text-xs text-slate-500">
              Pemakaian tinta dicatat otomatis saat Selesai Cetak; bahan pembantu dicatat saat Finishing.
            </p>
          </div>
          <button
            type="submit"
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-700 px-3.5 py-2 text-xs font-semibold text-white hover:bg-blue-800 cursor-pointer"
          >
            <Plus className="h-3.5 w-3.5" />
            Tambah Barang
          </button>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-4 lg:grid-cols-8 gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Kode *</label>
            <input
              required
              value={newSupply.kode}
              onChange={(e) => setNewSupply({ ...newSupply, kode: e.target.value })}
              placeholder="TINTA-LF"
              className="w-full rounded-lg border border-slate-300 px-2.5 py-2 text-sm font-mono uppercase"
            />
          </div>
          <div className="sm:col-span-2">
            <label className="block text-xs font-medium text-slate-700 mb-1">Nama Barang *</label>
            <input
              required
              value={newSupply.nama}
              onChange={(e) => setNewSupply({ ...newSupply, nama: e.target.value })}
              className="w-full rounded-lg border border-slate-300 px-2.5 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Kategori *</label>
            <select
              value={newSupply.kategori}
              onChange={(e) =>
                setNewSupply({ ...newSupply, kategori: e.target.value as SupplyCategory })
              }
              className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-sm"
            >
              {SUPPLY_CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Satuan</label>
            <input
              value={newSupply.satuan}
              onChange={(e) => setNewSupply({ ...newSupply, satuan: e.target.value })}
              className="w-full rounded-lg border border-slate-300 px-2.5 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Stok Awal</label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={newSupply.stok}
              onChange={(e) => setNewSupply({ ...newSupply, stok: e.target.value })}
              className="w-full rounded-lg border border-slate-300 px-2.5 py-2 text-sm font-mono"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Minimal</label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={newSupply.stok_minimum}
              onChange={(e) => setNewSupply({ ...newSupply, stok_minimum: e.target.value })}
              className="w-full rounded-lg border border-slate-300 px-2.5 py-2 text-sm font-mono"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Harga Satuan</label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={newSupply.harga_satuan}
              onChange={(e) => setNewSupply({ ...newSupply, harga_satuan: e.target.value })}
              className="w-full rounded-lg border border-slate-300 px-2.5 py-2 text-sm font-mono"
            />
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs sm:text-sm responsive-table">
            <thead className="bg-slate-50 border-y border-slate-200 text-xs font-semibold text-slate-600">
              <tr>
                <th className="text-left px-3 py-2.5">Barang</th>
                <th className="text-left px-3 py-2.5">Kategori</th>
                <th className="text-right px-3 py-2.5">Stok</th>
                <th className="text-right px-3 py-2.5">Minimal</th>
                <th className="text-right px-3 py-2.5">Harga</th>
                <th className="text-left px-3 py-2.5">Restock</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {supplyDrafts.map((s) => (
                <tr key={s.id} className={s.stok <= s.stok_minimum ? 'bg-amber-50' : ''}>
                  <td data-label="Barang" className="px-3 py-2">
                    <p className="font-medium text-slate-900">{s.nama}</p>
                    <p className="font-mono text-[11px] text-slate-500">
                      {s.kode} · {s.satuan}
                    </p>
                  </td>
                  <td data-label="Kategori" className="px-3 py-2 text-slate-600">
                    {SUPPLY_CATEGORIES.find((c) => c.value === s.kategori)?.label ?? s.kategori}
                  </td>
                  <td data-label="Stok" className="px-3 py-2 text-right font-mono font-semibold">
                    {s.stok}
                  </td>
                  <td data-label="Minimal" className="px-3 py-2 text-right">
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={s.stok_minimum}
                      onChange={(e) =>
                        setSupplyDrafts((prev) =>
                          prev.map((row) =>
                            row.id === s.id
                              ? { ...row, stok_minimum: Number(e.target.value) || 0 }
                              : row,
                          ),
                        )
                      }
                      className="w-20 rounded-md border border-slate-300 px-2 py-1 text-right font-mono text-xs"
                    />
                  </td>
                  <td data-label="Harga" className="px-3 py-2 text-right">
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={s.harga_satuan}
                      onChange={(e) =>
                        setSupplyDrafts((prev) =>
                          prev.map((row) =>
                            row.id === s.id
                              ? { ...row, harga_satuan: Number(e.target.value) || 0 }
                              : row,
                          ),
                        )
                      }
                      className="w-24 rounded-md border border-slate-300 px-2 py-1 text-right font-mono text-xs"
                    />
                  </td>
                  <td data-label="Restock" className="px-3 py-2">
                    <div className="flex items-center gap-1.5">
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={restockDrafts[s.id] ?? ''}
                        onChange={(e) =>
                          setRestockDrafts((prev) => ({ ...prev, [s.id]: e.target.value }))
                        }
                        placeholder="Jumlah"
                        className="w-20 rounded-md border border-slate-300 px-2 py-1 font-mono text-xs"
                      />
                      <button
                        type="button"
                        disabled={restockBusy === s.id}
                        onClick={() => handleRestock(s)}
                        className="rounded-md bg-slate-800 px-2 py-1 text-[11px] font-semibold text-white hover:bg-slate-700 disabled:opacity-50 cursor-pointer"
                      >
                        + Stok
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex justify-end">
          <button
            type="button"
            disabled={savingSupplies}
            onClick={handleSaveSupplies}
            className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50 cursor-pointer"
          >
            <Save className="h-3.5 w-3.5" />
            {savingSupplies ? 'Menyimpan...' : 'Simpan Master Supply'}
          </button>
        </div>
      </form>

      {/* Product Pricing Tiers */}
      <form
        onSubmit={handleSaveProducts}
        className="bg-white rounded-xl border border-slate-200 overflow-hidden"
      >
        <div className="p-4 border-b border-slate-200 flex items-center justify-between gap-4">
          <div>
            <h2 className="font-display text-sm font-semibold text-slate-900">
              Master Harga Jual (4 Tier Pelanggan) &amp; Harga Modal (HPP)
            </h2>
            <p className="text-xs text-slate-500">
              Berlaku per m² untuk produk meteran dan per pcs untuk produk satuan.
            </p>
          </div>
          <button
            type="submit"
            disabled={savingProducts}
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-700 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-800 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Save className="h-3.5 w-3.5" />
            {savingProducts ? 'Menyimpan...' : 'Simpan Harga Produk'}
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs sm:text-sm responsive-table">
            <thead className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
              <tr>
                <th className="text-left px-4 py-3">Produk</th>
                <th className="text-right px-3 py-3">Umum</th>
                <th className="text-right px-3 py-3">Reseller</th>
                <th className="text-right px-3 py-3">Prioritas</th>
                <th className="text-right px-3 py-3">Pegawai</th>
                <th className="text-right px-4 py-3">Modal (HPP)</th>
                <th className="text-left px-3 py-3">Mesin &amp; Satuan Hitung</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {productDrafts.map((p) => (
                <tr key={p.id}>
                  <td data-label="Produk" className="px-4 py-2.5 font-medium text-slate-900">
                    {p.nama_produk}
                    <span className="block text-[11px] text-slate-500 font-normal">
                      {p.kategori_produk === 'meteran' ? 'Per m²' : 'Per pcs'}
                    </span>
                  </td>
                  {(
                    ['harga_umum', 'harga_reseller', 'harga_prioritas', 'harga_pegawai', 'harga_modal'] as const
                  ).map((col) => (
                    <td key={col} data-label={col} className="px-3 py-2 text-right">
                      <input
                        type="number"
                        min={0}
                        value={p[col]}
                        onChange={(e) => updateProductField(p.id, col, e.target.value)}
                        className="w-24 rounded-md border border-slate-300 px-2 py-1 text-right font-mono tabular-nums text-xs"
                      />
                    </td>
                  ))}
                  <td data-label="Mesin & Hitung" className="px-3 py-2 space-y-1.5">
                    <select
                      value={p.mesin_default_id ?? ''}
                      onChange={(e) => updateProductMachine(p.id, e.target.value)}
                      className="w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-xs"
                    >
                      <option value="">Tanpa mesin default</option>
                      {machines.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.kode_mesin} · {m.nama_mesin}
                        </option>
                      ))}
                    </select>
                    <div className="flex items-center gap-1.5">
                      <select
                        value={p.satuan_hitung ?? 'pcs'}
                        onChange={(e) => updateProductSatuan(p.id, e.target.value)}
                        className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs"
                      >
                        <option value="pcs">pcs</option>
                        <option value="klik">klik</option>
                      </select>
                      {p.satuan_hitung === 'klik' && (
                        <input
                          type="number"
                          min={1}
                          value={p.klik_per_lembar ?? 1}
                          onChange={(e) =>
                            updateProductField(p.id, 'klik_per_lembar', e.target.value)
                          }
                          className="w-16 rounded-md border border-slate-300 px-2 py-1 text-right font-mono text-xs"
                          title="Klik per lembar"
                        />
                      )}
                    </div>
                    {p.satuan_hitung === 'klik' && (
                      <input
                        type="text"
                        value={p.ukuran_lembar ?? ''}
                        onChange={(e) => updateProductField(p.id, 'ukuran_lembar', e.target.value)}
                        placeholder="Ukuran lembar"
                        className="w-full rounded-md border border-slate-300 px-2 py-1 text-xs"
                      />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </form>

      {/* Finishing Extra Margin Formulas */}
      <form
        onSubmit={handleSaveFinishings}
        className="bg-white rounded-xl border border-slate-200 overflow-hidden"
      >
        <div className="p-4 border-b border-slate-200 flex items-center justify-between gap-4">
          <div>
            <h2 className="font-display text-sm font-semibold text-slate-900">
              Rumus Ekstra Bahan Finishing (cm)
            </h2>
            <p className="text-xs text-slate-500">
              Digunakan Operator Cetak untuk menghitung Ukuran Kotor produksi dan audit wos finishing.
            </p>
          </div>
          <button
            type="submit"
            disabled={savingFinishings}
            className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Save className="h-3.5 w-3.5" />
            {savingFinishings ? 'Menyimpan...' : 'Simpan Rumus Finishing'}
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs sm:text-sm responsive-table">
            <thead className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
              <tr>
                <th className="text-left px-4 py-3">Nama Finishing</th>
                <th className="text-right px-3 py-3">Kiri (cm)</th>
                <th className="text-right px-3 py-3">Kanan (cm)</th>
                <th className="text-right px-3 py-3">Atas (cm)</th>
                <th className="text-right px-4 py-3">Bawah (cm)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {finishingDrafts.map((f) => (
                <tr key={f.id}>
                  <td data-label="Finishing" className="px-4 py-2.5 font-medium text-slate-900">
                    {f.nama_finishing}
                  </td>
                  {(
                    ['ekstra_kiri_cm', 'ekstra_kanan_cm', 'ekstra_atas_cm', 'ekstra_bawah_cm'] as const
                  ).map((col) => (
                    <td key={col} data-label={col} className="px-3 py-2 text-right">
                      <input
                        type="number"
                        step="0.5"
                        min={0}
                        value={f[col]}
                        onChange={(e) => updateFinishingField(f.id, col, e.target.value)}
                        className="w-20 rounded-md border border-slate-300 px-2 py-1 text-right font-mono tabular-nums text-xs"
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </form>

      {/* Pengaturan Pajak Indonesia & Faktur */}
      <form
        onSubmit={handleSaveTax}
        className="bg-white rounded-xl border border-slate-200 p-5 space-y-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
          <div>
            <h2 className="font-display text-sm font-semibold text-slate-900">
              Pengaturan Pajak Indonesia &amp; Faktur (Global Default)
            </h2>
            <p className="text-xs text-slate-500">
              Prioritas perhitungan nota: Input per-nota → Pengaturan Instansi → Default Global ini.
            </p>
          </div>
          <button
            type="submit"
            disabled={savingTax}
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-700 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-800 disabled:opacity-50 cursor-pointer"
          >
            <Save className="h-3.5 w-3.5" />
            {savingTax ? 'Menyimpan...' : 'Simpan Pengaturan Pajak'}
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">PPN Default (%)</label>
            <input
              type="number"
              step="0.1"
              min={0}
              max={100}
              value={taxDraft.ppn_persen_default}
              onChange={(e) =>
                setTaxDraft((p) => ({ ...p, ppn_persen_default: Number(e.target.value) || 0 }))
              }
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono"
            />
            <p className="mt-1 text-[11px] text-slate-500">
              Acuan UU HPP / PMK 131/2024: jasa percetakan &amp; advertising non-mewah efektif 11%.
            </p>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">PPh 23 Jasa Default (%)</label>
            <input
              type="number"
              step="0.1"
              min={0}
              max={100}
              value={taxDraft.pph23_persen_default}
              onChange={(e) =>
                setTaxDraft((p) => ({ ...p, pph23_persen_default: Number(e.target.value) || 0 }))
              }
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono"
            />
            <p className="mt-1 text-[11px] text-slate-500">
              Tarif standar PPh 23 jasa maklon/periklanan badan: 2% dari DPP.
            </p>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Mode Harga Katalog</label>
            <select
              value={taxDraft.mode_harga}
              onChange={(e) =>
                setTaxDraft((p) => ({ ...p, mode_harga: e.target.value as TaxPriceMode }))
              }
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
            >
              <option value="belum_termasuk_ppn">Belum termasuk PPN (DPP + PPN)</option>
              <option value="sudah_termasuk_ppn">Sudah termasuk PPN (DPP dihitung mundur)</option>
            </select>
          </div>
        </div>

        <div className="flex flex-wrap gap-5 pt-1">
          <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-700 cursor-pointer">
            <input
              type="checkbox"
              checked={taxDraft.ppn_termasuk_diskon}
              onChange={(e) =>
                setTaxDraft((p) => ({ ...p, ppn_termasuk_diskon: e.target.checked }))
              }
              className="h-4 w-4 rounded border-slate-300 text-blue-700"
            />
            Hitung PPN setelah dikurangi diskon nota
          </label>
          <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-700 cursor-pointer">
            <input
              type="checkbox"
              checked={taxDraft.potong_pph23_otomatis}
              onChange={(e) =>
                setTaxDraft((p) => ({ ...p, potong_pph23_otomatis: e.target.checked }))
              }
              className="h-4 w-4 rounded border-slate-300 text-blue-700"
            />
            Otomatis potong PPh 23 jika instansi memiliki NPWP
          </label>
        </div>

        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
          <strong>Simulasi Nota Rp 1.000.000:</strong>{' '}
          {(() => {
            const contoh = 1_000_000;
            const ppn = taxDraft.ppn_persen_default;
            const pph = taxDraft.potong_pph23_otomatis ? taxDraft.pph23_persen_default : 0;
            if (taxDraft.mode_harga === 'sudah_termasuk_ppn' && ppn > 0) {
              const dpp = Math.round(contoh / (1 + ppn / 100));
              const ppnNom = contoh - dpp;
              const pphNom = Math.round((dpp * pph) / 100);
              return `DPP Rp ${dpp.toLocaleString('id-ID')} + PPN Rp ${ppnNom.toLocaleString('id-ID')} − PPh23 Rp ${pphNom.toLocaleString('id-ID')} = Total Rp ${(contoh - pphNom).toLocaleString('id-ID')}`;
            }
            const ppnNom = Math.round((contoh * ppn) / 100);
            const pphNom = Math.round((contoh * pph) / 100);
            return `DPP Rp ${contoh.toLocaleString('id-ID')} + PPN Rp ${ppnNom.toLocaleString('id-ID')} − PPh23 Rp ${pphNom.toLocaleString('id-ID')} = Total Rp ${(contoh + ppnNom - pphNom).toLocaleString('id-ID')}`;
          })()}
        </div>
      </form>

      {/* Master Instansi (Limit Kredit, Tempo, NPWP & Pajak) */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="p-4 border-b border-slate-200">
          <h2 className="font-display text-sm font-semibold text-slate-900">
            Pengaturan Instansi: Limit Kredit, Tempo &amp; Pajak
          </h2>
          <p className="text-xs text-slate-500">
            Atur batas kredit piutang, tempo jatuh tempo (hari), NPWP, status PKP, PPN, dan PPh 23 per instansi.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs sm:text-sm responsive-table">
            <thead className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
              <tr>
                <th className="text-left px-4 py-3">Instansi</th>
                <th className="text-left px-3 py-3">NPWP / PKP</th>
                <th className="text-right px-3 py-3">PPN / PPh 23</th>
                <th className="text-right px-3 py-3">Tempo (Hari)</th>
                <th className="text-right px-3 py-3">Limit Kredit (Rp)</th>
                <th className="text-right px-4 py-3">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {instansiDrafts.map((inst) => (
                <tr key={inst.id}>
                  <td data-label="Instansi" className="px-4 py-2.5 font-medium text-slate-900">
                    {inst.nama_instansi}
                  </td>
                  <td data-label="NPWP / PKP" className="px-3 py-2 text-xs text-slate-600">
                    <span className="font-mono">{inst.npwp || '-'}</span>
                    <span
                      className={`ml-2 inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                        inst.is_pkp ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'
                      }`}
                    >
                      {inst.is_pkp ? 'PKP' : 'Non-PKP'}
                    </span>
                  </td>
                  <td data-label="Pajak" className="px-3 py-2 text-right font-mono text-xs text-slate-700">
                    PPN {inst.ppn_persen ?? 0}% · PPh23 {inst.pph23_persen ?? 0}%
                  </td>
                  <td data-label="Tempo" className="px-3 py-2 text-right font-mono text-xs text-slate-700">
                    {inst.tempo_hari ?? 0} hari
                  </td>
                  <td data-label="Limit Kredit" className="px-3 py-2 text-right font-mono text-xs text-slate-700">
                    Rp {Number(inst.credit_limit ?? 0).toLocaleString('id-ID')}
                  </td>
                  <td data-label="Aksi" className="px-4 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => setEditingInstansi({ ...inst })}
                      className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
                    >
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {editingInstansi && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <form
            onSubmit={handleSaveInstansi}
            className="bg-white rounded-xl border border-slate-200 w-full max-w-lg p-6 space-y-4"
          >
            <h3 className="font-display text-base font-semibold text-slate-900">
              Edit Pengaturan Instansi
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-slate-700 mb-1">Nama Instansi *</label>
                <input
                  type="text"
                  required
                  value={editingInstansi.nama_instansi}
                  onChange={(e) =>
                    setEditingInstansi({ ...editingInstansi, nama_instansi: e.target.value })
                  }
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">NPWP</label>
                <input
                  type="text"
                  value={editingInstansi.npwp ?? ''}
                  onChange={(e) =>
                    setEditingInstansi({ ...editingInstansi, npwp: e.target.value })
                  }
                  placeholder="00.000.000.0-000.000"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono"
                />
              </div>
              <div className="flex items-end pb-2">
                <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={Boolean(editingInstansi.is_pkp)}
                    onChange={(e) =>
                      setEditingInstansi({
                        ...editingInstansi,
                        is_pkp: e.target.checked,
                        ppn_persen: e.target.checked && !(editingInstansi.ppn_persen ?? 0) ? 11 : editingInstansi.ppn_persen,
                      })
                    }
                    className="h-4 w-4 rounded border-slate-300 text-blue-700"
                  />
                  Status PKP (Pengusaha Kena Pajak)
                </label>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">PPN (%)</label>
                <input
                  type="number"
                  step="0.1"
                  min={0}
                  max={100}
                  value={editingInstansi.ppn_persen ?? 0}
                  onChange={(e) =>
                    setEditingInstansi({ ...editingInstansi, ppn_persen: Number(e.target.value) || 0 })
                  }
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">PPh 23 (%)</label>
                <input
                  type="number"
                  step="0.1"
                  min={0}
                  max={100}
                  value={editingInstansi.pph23_persen ?? 0}
                  onChange={(e) =>
                    setEditingInstansi({ ...editingInstansi, pph23_persen: Number(e.target.value) || 0 })
                  }
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Tempo Jatuh Tempo (Hari)</label>
                <input
                  type="number"
                  min={0}
                  value={editingInstansi.tempo_hari ?? 0}
                  onChange={(e) =>
                    setEditingInstansi({ ...editingInstansi, tempo_hari: Math.max(0, Number(e.target.value) || 0) })
                  }
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Limit Kredit (Rp)</label>
                <input
                  type="number"
                  min={0}
                  step={50000}
                  value={editingInstansi.credit_limit ?? 0}
                  onChange={(e) =>
                    setEditingInstansi({ ...editingInstansi, credit_limit: Math.max(0, Number(e.target.value) || 0) })
                  }
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setEditingInstansi(null)}
                className="rounded-lg border border-slate-300 px-3.5 py-2 text-xs font-medium text-slate-700 cursor-pointer"
              >
                Batal
              </button>
              <button
                type="submit"
                disabled={savingInstansi}
                className="rounded-lg bg-blue-700 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-800 disabled:opacity-50 cursor-pointer"
              >
                {savingInstansi ? 'Menyimpan...' : 'Simpan Pengaturan'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

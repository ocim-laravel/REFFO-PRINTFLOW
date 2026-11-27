import {
  Component,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ErrorInfo,
  type ReactNode,
} from 'react';
import { Plus, RefreshCw } from 'lucide-react';
import type {
  AdvertisingSpk,
  BootstrapPayload,
  CetakGrup,
  Instansi,
  Order,
  PrintBatch,
  User,
} from './types';
import { apiFetch, getApiToken, setApiToken, setUnauthorizedHandler } from './lib/api';
import { ROLE_LABEL } from './lib/format';
import { LoginView } from './components/LoginView';
import { AppShell, getDefaultNavForRole, type NavKey } from './components/AppShell';
import {
  AdminOrdersView,
  type OrderCounts,
  type OrderTab,
} from './components/admin/AdminOrdersView';
import { DesignReviewView } from './components/admin/DesignReviewView';
import { OrderCreateModal } from './components/admin/OrderCreateModal';
import { OrderSummaryModal } from './components/admin/OrderSummaryModal';
import { DesainerView } from './components/desainer/DesainerView';
import { OperatorView, type OperatorQueueItem } from './components/operator/OperatorView';
import { FinishingView } from './components/finishing/FinishingView';
import { AdvertisingView } from './components/advertising/AdvertisingView';
import { SerahTerimaView } from './components/shared/SerahTerimaView';
import { RiwayatView } from './components/shared/RiwayatView';
import { OwnerDashboardView, type OwnerDashboardData } from './components/owner/OwnerDashboardView';
import { OwnerMaterialsView, type MaterialReportData } from './components/owner/OwnerMaterialsView';
import { OwnerProfitLossView, type ProfitLossData } from './components/owner/OwnerProfitLossView';
import { OwnerFinanceView } from './components/owner/OwnerFinanceView';
import { OwnerStaffView } from './components/owner/OwnerStaffView';
import { OwnerSettingsView } from './components/owner/OwnerSettingsView';
import { OwnerProductionView } from './components/owner/OwnerProductionView';
import { OwnerInsentifView } from './components/owner/OwnerInsentifView';
import { OwnerProfitabilitasView } from './components/owner/OwnerProfitabilitasView';
import { OwnerPurchasingView } from './components/owner/OwnerPurchasingView';
import { OwnerIntegrationsView } from './components/owner/OwnerIntegrationsView';
import { OwnerWhatsAppGatewayView } from './components/owner/OwnerWhatsAppGatewayView';
import { AdminShiftView } from './components/admin/AdminShiftView';
import { SelfApprovalView } from './components/SelfApprovalView';

const STORAGE_KEY = 'reffo_active_user_id';

function getPublicApprovalToken(): string | null {
  const params = new URLSearchParams(window.location.search);
  const fromQuery = params.get('approval');
  if (fromQuery) return fromQuery;
  const match = window.location.pathname.match(/^\/acc\/([^/]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

class AppErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean; message: string }
> {
  state = { hasError: false, message: '' };

  static getDerivedStateFromError(error: unknown) {
    return {
      hasError: true,
      message: error instanceof Error ? error.message : 'Terjadi kesalahan yang tidak terduga.',
    };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Application error', error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-slate-100 p-6">
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 text-center shadow-sm">
            <h1 className="font-display text-lg font-semibold text-slate-900">
              Aplikasi mengalami kendala
            </h1>
            <p className="mt-2 text-sm text-slate-600">{this.state.message}</p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-5 rounded-lg bg-blue-700 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-800 cursor-pointer"
            >
              Muat Ulang Aplikasi
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function AppContent() {
  const [accounts, setAccounts] = useState<User[]>([]);
  const [demoSwitchEnabled, setDemoSwitchEnabled] = useState(true);
  const [activeUser, setActiveUser] = useState<User | null>(null);
  const [activeNav, setActiveNav] = useState<NavKey>('admin_orders');
  const [bootstrap, setBootstrap] = useState<BootstrapPayload | null>(null);

  const [orders, setOrders] = useState<Order[]>([]);
  const [orderTab, setOrderTab] = useState<OrderTab>('semua');
  const [orderCounts, setOrderCounts] = useState<OrderCounts | undefined>();
  const [desainerQueue, setDesainerQueue] = useState<Order[]>([]);
  const [operatorQueue, setOperatorQueue] = useState<OperatorQueueItem[]>([]);
  const [operatorBatches, setOperatorBatches] = useState<PrintBatch[]>([]);
  const [operatorGrup, setOperatorGrup] = useState<CetakGrup[]>([]);
  const [finishingQueue, setFinishingQueue] = useState<OperatorQueueItem[]>([]);
  const [advertisingSpks, setAdvertisingSpks] = useState<AdvertisingSpk[]>([]);
  const [serahTerimaOrders, setSerahTerimaOrders] = useState<Order[]>([]);
  const [riwayatOrders, setRiwayatOrders] = useState<Order[]>([]);

  const [ownerDash, setOwnerDash] = useState<OwnerDashboardData | null>(null);
  const [ownerMaterials, setOwnerMaterials] = useState<MaterialReportData | null>(null);
  const [ownerProfitLoss, setOwnerProfitLoss] = useState<ProfitLossData | null>(null);

  const [dateFilter, setDateFilter] = useState({ dari: '', sampai: '' });
  const [loadingView, setLoadingView] = useState(false);

  const [createOrderOpen, setCreateOrderOpen] = useState(false);
  const [inspectedOrder, setInspectedOrder] = useState<Order | null>(null);
  const [flash, setFlash] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [serverBadges, setServerBadges] = useState<Partial<Record<NavKey, number>>>({});
  const [shiftAktif, setShiftAktif] = useState(false);
  const handledDeepLinkRef = useRef(false);

  const notify = useCallback((type: 'success' | 'error', message: string) => {
    setFlash({ type, message });
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      setApiToken(null);
      window.sessionStorage.removeItem(STORAGE_KEY);
      setActiveUser(null);
      setInspectedOrder(null);
      setCreateOrderOpen(false);
    });
    return () => setUnauthorizedHandler(null);
  }, []);

  useEffect(() => {
    apiFetch<{ accounts: User[]; demo_switch_enabled?: boolean }>('/api/auth/accounts')
      .then((res) => {
        setAccounts(res.accounts);
        setDemoSwitchEnabled(res.demo_switch_enabled !== false);
        const savedId = window.sessionStorage.getItem(STORAGE_KEY);
        const token = getApiToken();
        if (savedId && token) {
          const matched = res.accounts.find((a) => a.id === Number(savedId));
          if (matched) {
            setActiveUser(matched);
            setActiveNav(getDefaultNavForRole(matched.role));
          }
        }
      })
      .catch((err) => {
        notify('error', err instanceof Error ? err.message : 'Gagal memuat daftar akun.');
      });
  }, [notify]);

  const loadBootstrap = useCallback(async () => {
    if (!activeUser) return;
    const data = await apiFetch<BootstrapPayload>('/api/bootstrap');
    setBootstrap(data);
    if (typeof data.demo_switch_enabled === 'boolean') {
      setDemoSwitchEnabled(data.demo_switch_enabled);
    }
  }, [activeUser]);

  const loadActiveData = useCallback(async () => {
    if (!activeUser) return;
    setLoadingView(true);
    try {
      const [, badgeRes] = await Promise.all([
        loadBootstrap(),
        apiFetch<{ badges: Partial<Record<NavKey, number>>; shift_aktif?: boolean }>('/api/badges').catch(() => null),
      ]);
      if (badgeRes) {
        setServerBadges(badgeRes.badges);
        setShiftAktif(Boolean(badgeRes.shift_aktif));
      }

      if (activeNav === 'admin_orders' || activeNav === 'owner_rekap') {
        const res = await apiFetch<{ orders: Order[]; counts?: OrderCounts }>(
          `/api/orders?tab=${orderTab}`,
        );
        setOrders(res.orders);
        if (res.counts) setOrderCounts(res.counts);
      } else if (activeNav === 'admin_reviews') {
        const res = await apiFetch<{ orders: Order[] }>('/api/admin/design-reviews');
        setOrders(res.orders);
      } else if (activeNav === 'desainer_queue') {
        const res = await apiFetch<{ orders: Order[] }>('/api/desainer/queue');
        setDesainerQueue(res.orders);
      } else if (activeNav === 'operator_queue') {
        const res = await apiFetch<{
          items: OperatorQueueItem[];
          batches: PrintBatch[];
          grup?: CetakGrup[];
        }>('/api/operator/queue');
        setOperatorQueue(res.items);
        setOperatorBatches(res.batches ?? []);
        setOperatorGrup(res.grup ?? []);
      } else if (activeNav === 'finishing_queue') {
        const res = await apiFetch<{ items: OperatorQueueItem[] }>('/api/finishing/queue');
        setFinishingQueue(res.items);
      } else if (activeNav === 'advertising_spk') {
        const res = await apiFetch<{ spks: AdvertisingSpk[] }>('/api/advertising/spks');
        setAdvertisingSpks(res.spks);
      } else if (activeNav === 'serah_terima') {
        const res = await apiFetch<{ orders: Order[] }>('/api/serah-terima');
        setSerahTerimaOrders(res.orders);
      } else if (activeNav === 'riwayat') {
        const divMap: Record<string, string> = {
          desainer: 'desainer',
          operator_cetak: 'operator',
          finishing: 'finishing',
          advertising: 'advertising',
        };
        const div = divMap[activeUser.role] ?? 'desainer';
        const res = await apiFetch<{ orders: Order[] }>(`/api/riwayat/${div}`);
        setRiwayatOrders(res.orders);
      } else if (activeNav === 'owner_dashboard') {
        const res = await apiFetch<OwnerDashboardData>('/api/owner/dashboard');
        setOwnerDash(res);
      } else if (activeNav === 'owner_materials') {
        const qs = new URLSearchParams();
        if (dateFilter.dari) qs.set('dari', dateFilter.dari);
        if (dateFilter.sampai) qs.set('sampai', dateFilter.sampai);
        const res = await apiFetch<MaterialReportData>(
          `/api/owner/reports/materials?${qs.toString()}`,
        );
        setOwnerMaterials(res);
      } else if (activeNav === 'owner_profit_loss') {
        const qs = new URLSearchParams();
        if (dateFilter.dari) qs.set('dari', dateFilter.dari);
        if (dateFilter.sampai) qs.set('sampai', dateFilter.sampai);
        const res = await apiFetch<ProfitLossData>(
          `/api/owner/reports/profit-loss?${qs.toString()}`,
        );
        setOwnerProfitLoss(res);
      }
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Gagal memuat data.');
    } finally {
      setLoadingView(false);
    }
  }, [activeUser, activeNav, dateFilter, loadBootstrap, notify, orderTab]);

  useEffect(() => {
    if (activeUser) {
      loadActiveData();
    }
  }, [activeUser, activeNav, loadActiveData]);

  useEffect(() => {
    if (!activeUser) return;
    const pollBadges = async () => {
      try {
        const res = await apiFetch<{
          badges: Partial<Record<NavKey, number>>;
          shift_aktif?: boolean;
        }>('/api/badges');
        setServerBadges(res.badges);
        setShiftAktif(Boolean(res.shift_aktif));
      } catch {
        return;
      }
    };
    const timer = window.setInterval(pollBadges, 30_000);
    return () => window.clearInterval(timer);
  }, [activeUser]);

  // URL Deep-Link handler for QR Code Nota (?nota=INV-... or ?orderId=...)
  useEffect(() => {
    if (!activeUser || handledDeepLinkRef.current) return;
    const params = new URLSearchParams(window.location.search);
    const notaParam = params.get('nota');
    const orderIdParam = params.get('orderId');
    if (!notaParam && !orderIdParam) return;
    handledDeepLinkRef.current = true;

    const endpoint = notaParam
      ? `/api/orders/by-nota/${encodeURIComponent(notaParam)}`
      : `/api/orders/${Number(orderIdParam)}`;

    apiFetch<{ order: Order }>(endpoint)
      .then((res) => {
        setInspectedOrder(res.order);
      })
      .catch((err) => {
        notify('error', err instanceof Error ? err.message : 'Nota dari tautan QR tidak ditemukan.');
      });
  }, [activeUser, notify]);

  // Real-time SSE sync across open division dashboards
  useEffect(() => {
    if (!activeUser) return;
    const source = new EventSource('/api/events', { withCredentials: true });
    let timer: number | null = null;

    const handleDomainUpdate = (evt: MessageEvent) => {
      if (timer !== null) {
        window.clearTimeout(timer);
      }
      timer = window.setTimeout(() => {
        loadActiveData();
        try {
          const parsed = JSON.parse(evt.data) as { orderId?: number };
          if (parsed.orderId) {
            setInspectedOrder((prev) => {
              if (!prev || prev.id !== parsed.orderId) return prev;
              apiFetch<{ order: Order }>(`/api/orders/${prev.id}`)
                .then((res) => setInspectedOrder(res.order))
                .catch(() => undefined);
              return prev;
            });
          }
        } catch {
          // ignore malformed SSE payload
        }
      }, 350);
    };

    source.addEventListener('domain_update', handleDomainUpdate);
    return () => {
      if (timer !== null) window.clearTimeout(timer);
      source.removeEventListener('domain_update', handleDomainUpdate);
      source.close();
    };
  }, [activeUser, loadActiveData]);

  const handleAuthenticate = (user: User, token: string) => {
    setApiToken(token);
    window.sessionStorage.setItem(STORAGE_KEY, String(user.id));
    setActiveUser(user);
    setActiveNav(getDefaultNavForRole(user.role));
    setFlash(null);
  };

  const handleSwitchAccount = async (target: User) => {
    try {
      const res = await apiFetch<{ user: User; token: string }>('/api/auth/switch', {
        method: 'POST',
        body: JSON.stringify({ userId: target.id }),
      });
      handleAuthenticate(res.user, res.token);
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Gagal berpindah divisi.');
    }
  };

  const handleLogout = async () => {
    await apiFetch('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
    setApiToken(null);
    window.sessionStorage.removeItem(STORAGE_KEY);
    setActiveUser(null);
    setBootstrap(null);
    setInspectedOrder(null);
    setFlash(null);
  };

  const handleInspectOrderId = async (orderId: number) => {
    try {
      const res = await apiFetch<{ order: Order }>(`/api/orders/${orderId}`);
      setInspectedOrder(res.order);
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Gagal memuat detail nota.');
    }
  };

  const handleInstansiAdded = (inst: Instansi) => {
    setBootstrap((prev) =>
      prev ? { ...prev, instansis: [...prev.instansis, inst] } : prev,
    );
  };

  const pageMeta = useMemo(() => {
    const titles: Record<NavKey, string> = {
      admin_orders: 'Daftar Nota & Order',
      admin_reviews: 'Review Desain (ACC / Revisi)',
      admin_shift: 'Shift & Tutup Kasir Harian',
      admin_whatsapp: 'Setting WhatsApp Gateway (Admin)',
      desainer_queue: 'Antrean Desain',
      operator_queue: 'Antrean Cetak Mesin',
      finishing_queue: 'Antrean Finishing',
      advertising_spk: 'SPK Lapangan Advertising',
      serah_terima: 'Serah Terima Barang',
      riwayat: 'Riwayat Pekerjaan Selesai',
      owner_dashboard: 'Ringkasan Workshop',
      owner_rekap: 'Rekap Semua Nota',
      owner_materials: 'Stok & Audit Bahan',
      owner_profit_loss: 'Laporan Laba Rugi',
      owner_finance: 'Cashflow, Piutang & Margin',
      owner_production: 'KPI Produksi & Mesin',
      owner_insentif: 'KPI & Insentif Tim',
      owner_profitabilitas: 'Analisis Profitabilitas Produk & Klien',
      owner_purchasing: 'Supplier, Purchase Order & Hutang Dagang',
      owner_integrations: 'WhatsApp, Ekspor & Pemeliharaan TIFF',
      owner_whatsapp_gateway: 'Setting → WhatsApp Gateway',
      owner_staff: 'Manajemen Staf & Audit Log',
      owner_settings: 'Pengaturan Master',
    };
    return {
      title: titles[activeNav],
      parent: activeUser ? ROLE_LABEL[activeUser.role] : undefined,
    };
  }, [activeNav, activeUser]);

  const badges = useMemo<Partial<Record<NavKey, number>>>(() => {
    return {
      ...serverBadges,
      ...(orders.length > 0
        ? {
            admin_reviews: orders.filter((o) =>
              o.items.some((i) => i.status_produksi === 'menunggu_acc' && !i.acc_admin_id),
            ).length,
          }
        : {}),
      ...(activeNav === 'desainer_queue' ? { desainer_queue: desainerQueue.length } : {}),
      ...(activeNav === 'operator_queue' ? { operator_queue: operatorQueue.length } : {}),
      ...(activeNav === 'finishing_queue' ? { finishing_queue: finishingQueue.length } : {}),
      ...(activeNav === 'advertising_spk'
        ? { advertising_spk: advertisingSpks.filter((s) => s.status_lapangan !== 'selesai').length }
        : {}),
      ...(activeNav === 'serah_terima' ? { serah_terima: serahTerimaOrders.length } : {}),
    };
  }, [serverBadges, activeNav, orders, desainerQueue, operatorQueue, finishingQueue, advertisingSpks, serahTerimaOrders]);

  const publicApprovalToken = useMemo(() => getPublicApprovalToken(), []);

  if (publicApprovalToken) {
    return <SelfApprovalView token={publicApprovalToken} />;
  }

  if (!activeUser) {
    return (
      <LoginView
        accounts={accounts}
        demoSwitchEnabled={demoSwitchEnabled}
        onAuthenticated={handleAuthenticate}
      />
    );
  }

  const primaryAction =
    activeUser.role === 'admin' && activeNav === 'admin_orders' ? (
      <button
        type="button"
        onClick={() => setCreateOrderOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-lg bg-blue-700 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-800 whitespace-nowrap shrink-0 cursor-pointer"
      >
        <Plus className="h-4 w-4" />
        Buat Nota Baru
      </button>
    ) : (
      <button
        type="button"
        onClick={() => loadActiveData()}
        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0 cursor-pointer"
      >
        <RefreshCw className={`h-3.5 w-3.5 ${loadingView ? 'animate-spin' : ''}`} />
        Segarkan Data
      </button>
    );

  return (
    <AppShell
      user={activeUser}
      accounts={accounts}
      activeNav={activeNav}
      onSelectNav={setActiveNav}
      onSwitchAccount={handleSwitchAccount}
      onLogout={handleLogout}
      pageTitle={pageMeta.title}
      breadcrumbParent={pageMeta.parent}
      primaryAction={primaryAction}
      flash={flash}
      onDismissFlash={() => setFlash(null)}
      badges={badges}
      shiftAktif={shiftAktif || Boolean(bootstrap?.shifts?.some((s) => s.status === 'buka'))}
      demoSwitchEnabled={demoSwitchEnabled}
    >
      {(activeNav === 'admin_orders' || activeNav === 'owner_rekap') && (
        <AdminOrdersView
          orders={orders}
          loading={loadingView}
          readOnly={activeUser.role === 'owner'}
          tab={orderTab}
          counts={orderCounts}
          onTabChange={setOrderTab}
          onInspectOrder={setInspectedOrder}
          onGoToReview={() => setActiveNav('admin_reviews')}
          onOpenCreate={() => setCreateOrderOpen(true)}
        />
      )}

      {activeNav === 'admin_reviews' && (
        <DesignReviewView
          orders={orders}
          onRefresh={loadActiveData}
          onNotify={notify}
        />
      )}

      {activeNav === 'admin_shift' && (
        <AdminShiftView onRefresh={loadActiveData} onNotify={notify} />
      )}

      {activeNav === 'admin_whatsapp' && (
        <OwnerWhatsAppGatewayView
          apiPrefix="/api/admin/settings/whatsapp"
          title="Setting WhatsApp Gateway (Admin — Sementara)"
          onNotify={notify}
        />
      )}

      {activeNav === 'desainer_queue' && (
        <DesainerView
          orders={desainerQueue}
          loading={loadingView}
          onRefresh={loadActiveData}
          onNotify={notify}
          onInspectOrder={setInspectedOrder}
        />
      )}

      {activeNav === 'operator_queue' && (
        <OperatorView
          items={operatorQueue}
          rolls={bootstrap?.rolls ?? []}
          offcuts={bootstrap?.offcuts ?? []}
          machines={bootstrap?.machines ?? []}
          supplies={bootstrap?.supplies ?? []}
          batches={operatorBatches}
          cattoffs={bootstrap?.cattoffs ?? []}
          tintaWarna={bootstrap?.tinta_warna ?? []}
          grup={operatorGrup}
          loading={loadingView}
          onRefresh={loadActiveData}
          onNotify={notify}
        />
      )}

      {activeNav === 'finishing_queue' && (
        <FinishingView
          items={finishingQueue}
          supplies={bootstrap?.supplies ?? []}
          loading={loadingView}
          onRefresh={loadActiveData}
          onNotify={notify}
        />
      )}

      {activeNav === 'advertising_spk' && (
        <AdvertisingView
          spks={advertisingSpks}
          loading={loadingView}
          onRefresh={loadActiveData}
          onNotify={notify}
        />
      )}

      {activeNav === 'serah_terima' && (
        <SerahTerimaView
          orders={serahTerimaOrders}
          role={activeUser.role}
          loading={loadingView}
          onRefresh={loadActiveData}
          onNotify={notify}
        />
      )}

      {activeNav === 'riwayat' && (
        <RiwayatView
          orders={riwayatOrders}
          role={activeUser.role}
          loading={loadingView}
          onInspectOrder={setInspectedOrder}
        />
      )}

      {activeNav === 'owner_dashboard' && (
        <OwnerDashboardView
          data={ownerDash}
          loading={loadingView}
          onInspectOrderId={handleInspectOrderId}
          onOpenSettings={() => setActiveNav('owner_settings')}
        />
      )}

      {activeNav === 'owner_materials' && (
        <OwnerMaterialsView
          data={ownerMaterials}
          dari={dateFilter.dari}
          sampai={dateFilter.sampai}
          onChangeFilter={(dari, sampai) => setDateFilter({ dari, sampai })}
          loading={loadingView}
          onNotify={notify}
          onRefresh={loadActiveData}
        />
      )}

      {activeNav === 'owner_profit_loss' && (
        <OwnerProfitLossView
          data={ownerProfitLoss}
          dari={dateFilter.dari}
          sampai={dateFilter.sampai}
          onChangeFilter={(dari, sampai) => setDateFilter({ dari, sampai })}
          onRefresh={loadActiveData}
          onNotify={notify}
          loading={loadingView}
        />
      )}

      {activeNav === 'owner_finance' && (
        <OwnerFinanceView
          dari={dateFilter.dari}
          sampai={dateFilter.sampai}
          onChangeFilter={(dari, sampai) => setDateFilter({ dari, sampai })}
          onNotify={notify}
        />
      )}

      {activeNav === 'owner_production' && (
        <OwnerProductionView onNotify={notify} />
      )}

      {activeNav === 'owner_insentif' && (
        <OwnerInsentifView
          dari={dateFilter.dari}
          sampai={dateFilter.sampai}
          onChangeFilter={(dari, sampai) => setDateFilter({ dari, sampai })}
          onNotify={notify}
        />
      )}

      {activeNav === 'owner_profitabilitas' && (
        <OwnerProfitabilitasView
          dari={dateFilter.dari}
          sampai={dateFilter.sampai}
          onChangeFilter={(dari, sampai) => setDateFilter({ dari, sampai })}
          onNotify={notify}
        />
      )}

      {activeNav === 'owner_purchasing' && (
        <OwnerPurchasingView onNotify={notify} />
      )}

      {activeNav === 'owner_integrations' && (
        <OwnerIntegrationsView onNotify={notify} />
      )}

      {activeNav === 'owner_whatsapp_gateway' && (
        <OwnerWhatsAppGatewayView onNotify={notify} />
      )}

      {activeNav === 'owner_staff' && (
        <OwnerStaffView onNotify={notify} />
      )}

      {activeNav === 'owner_settings' && bootstrap && (
        <OwnerSettingsView
          products={bootstrap.products}
          finishings={bootstrap.finishings}
          machines={bootstrap?.machines ?? []}
          supplies={bootstrap?.supplies ?? []}
          instansis={bootstrap?.instansis ?? []}
          taxSettings={bootstrap?.tax_settings}
          onRefreshBootstrap={loadBootstrap}
          onNotify={notify}
        />
      )}

      {bootstrap && (
        <OrderCreateModal
          open={createOrderOpen}
          onClose={() => setCreateOrderOpen(false)}
          products={bootstrap.products}
          finishings={bootstrap.finishings}
          instansis={bootstrap.instansis}
          customers={bootstrap.customers}
          taxSettings={bootstrap.tax_settings}
          onInstansiAdded={handleInstansiAdded}
          onCreated={async (created) => {
            await loadActiveData();
            setInspectedOrder(created);
            notify('success', `Nota ${created.no_nota} berhasil dibuat dan masuk antrean desain.`);
          }}
          onNotify={notify}
        />
      )}

      <OrderSummaryModal
        order={inspectedOrder}
        role={activeUser.role}
        onClose={() => setInspectedOrder(null)}
        onUpdated={async (updated) => {
          setInspectedOrder(updated);
          await loadActiveData();
        }}
        onNotify={notify}
      />
    </AppShell>
  );
}

export default function App() {
  return (
    <AppErrorBoundary>
      <AppContent />
    </AppErrorBoundary>
  );
}

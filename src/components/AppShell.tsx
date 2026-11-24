import React, { useState } from 'react';
import {
  ClipboardList,
  CheckCircle2,
  Palette,
  Printer,
  Scissors,
  HardHat,
  PackageCheck,
  History,
  BarChart3,
  Layers,
  TrendingUp,
  Settings,
  LogOut,
  Menu,
  X,
  ArrowLeftRight,
  Wallet,
  Users,
  Activity,
  ShoppingCart,
  MessageSquare,
} from 'lucide-react';
import type { User, UserRole } from '../types';
import { ROLE_LABEL } from '../lib/format';

export type NavKey =
  | 'admin_orders'
  | 'admin_reviews'
  | 'admin_shift'
  | 'desainer_queue'
  | 'operator_queue'
  | 'finishing_queue'
  | 'advertising_spk'
  | 'serah_terima'
  | 'riwayat'
  | 'owner_dashboard'
  | 'owner_rekap'
  | 'owner_materials'
  | 'owner_profit_loss'
  | 'owner_finance'
  | 'owner_production'
  | 'owner_insentif'
  | 'owner_profitabilitas'
  | 'owner_purchasing'
  | 'owner_integrations'
  | 'owner_staff'
  | 'owner_settings';

interface NavItem {
  key: NavKey;
  label: string;
  icon: React.ReactNode;
  badge?: number;
}

interface AppShellProps {
  user: User;
  accounts: User[];
  activeNav: NavKey;
  onSelectNav: (nav: NavKey) => void;
  onSwitchAccount: (user: User) => void;
  onLogout: () => void;
  pageTitle: string;
  breadcrumbParent?: string;
  primaryAction?: React.ReactNode;
  flash: { type: 'success' | 'error'; message: string } | null;
  onDismissFlash: () => void;
  badges?: Partial<Record<NavKey, number>>;
  demoSwitchEnabled?: boolean;
  children: React.ReactNode;
}

export function getDefaultNavForRole(role: UserRole): NavKey {
  switch (role) {
    case 'admin':
      return 'admin_orders';
    case 'desainer':
      return 'desainer_queue';
    case 'operator_cetak':
      return 'operator_queue';
    case 'finishing':
      return 'finishing_queue';
    case 'advertising':
      return 'advertising_spk';
    case 'owner':
      return 'owner_dashboard';
  }
}

export const AppShell: React.FC<AppShellProps> = ({
  user,
  accounts,
  activeNav,
  onSelectNav,
  onSwitchAccount,
  onLogout,
  pageTitle,
  breadcrumbParent,
  primaryAction,
  flash,
  onDismissFlash,
  badges = {},
  demoSwitchEnabled = true,
  children,
}) => {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const navItems: NavItem[] = React.useMemo(() => {
    switch (user.role) {
      case 'admin':
        return [
          { key: 'admin_orders', label: 'Daftar Nota & Order', icon: <ClipboardList className="h-4 w-4" /> },
          { key: 'admin_reviews', label: 'Review Desain (ACC)', icon: <CheckCircle2 className="h-4 w-4" />, badge: badges.admin_reviews },
          { key: 'admin_shift', label: 'Shift & Tutup Kasir', icon: <Wallet className="h-4 w-4" /> },
          { key: 'serah_terima', label: 'Serah Terima Barang', icon: <PackageCheck className="h-4 w-4" />, badge: badges.serah_terima },
        ];
      case 'desainer':
        return [
          { key: 'desainer_queue', label: 'Antrean Desain', icon: <Palette className="h-4 w-4" />, badge: badges.desainer_queue },
          { key: 'serah_terima', label: 'Serah Terima Barang', icon: <PackageCheck className="h-4 w-4" /> },
          { key: 'riwayat', label: 'Riwayat Selesai', icon: <History className="h-4 w-4" /> },
        ];
      case 'operator_cetak':
        return [
          { key: 'operator_queue', label: 'Antrean Cetak', icon: <Printer className="h-4 w-4" />, badge: badges.operator_queue },
          { key: 'serah_terima', label: 'Serah Terima Barang', icon: <PackageCheck className="h-4 w-4" /> },
          { key: 'riwayat', label: 'Riwayat Selesai', icon: <History className="h-4 w-4" /> },
        ];
      case 'finishing':
        return [
          { key: 'finishing_queue', label: 'Antrean Finishing', icon: <Scissors className="h-4 w-4" />, badge: badges.finishing_queue },
          { key: 'serah_terima', label: 'Serah Terima Barang', icon: <PackageCheck className="h-4 w-4" /> },
          { key: 'riwayat', label: 'Riwayat Selesai', icon: <History className="h-4 w-4" /> },
        ];
      case 'advertising':
        return [
          { key: 'advertising_spk', label: 'SPK Lapangan', icon: <HardHat className="h-4 w-4" />, badge: badges.advertising_spk },
          { key: 'serah_terima', label: 'Serah Terima Barang', icon: <PackageCheck className="h-4 w-4" /> },
          { key: 'riwayat', label: 'Riwayat Selesai', icon: <History className="h-4 w-4" /> },
        ];
      case 'owner':
        return [
          { key: 'owner_dashboard', label: 'Ringkasan Workshop', icon: <BarChart3 className="h-4 w-4" /> },
          { key: 'owner_rekap', label: 'Rekap Semua Nota', icon: <ClipboardList className="h-4 w-4" /> },
          { key: 'owner_materials', label: 'Stok & Audit Bahan', icon: <Layers className="h-4 w-4" /> },
          { key: 'owner_profit_loss', label: 'Laporan Laba Rugi', icon: <TrendingUp className="h-4 w-4" /> },
          { key: 'owner_finance', label: 'Cashflow & Piutang', icon: <Wallet className="h-4 w-4" /> },
          { key: 'owner_purchasing', label: 'Supplier & Purchase Order', icon: <ShoppingCart className="h-4 w-4" /> },
          { key: 'owner_production', label: 'KPI Produksi', icon: <Activity className="h-4 w-4" /> },
          { key: 'owner_insentif', label: 'KPI & Insentif Tim', icon: <Wallet className="h-4 w-4" /> },
          { key: 'owner_profitabilitas', label: 'Analisis Profitabilitas', icon: <TrendingUp className="h-4 w-4" /> },
          { key: 'owner_integrations', label: 'Integrasi & Pemeliharaan', icon: <MessageSquare className="h-4 w-4" /> },
          { key: 'owner_staff', label: 'Staf & Audit Log', icon: <Users className="h-4 w-4" /> },
          { key: 'owner_settings', label: 'Pengaturan Master', icon: <Settings className="h-4 w-4" /> },
        ];
    }
  }, [user.role, badges]);

  const selectItem = (key: NavKey) => {
    onSelectNav(key);
    setSidebarOpen(false);
  };

  return (
    <div className="min-h-screen bg-slate-50 flex">
      {/* Mobile backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-slate-950/60 lg:hidden"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Sidebar */}
      <aside
        className={`no-print fixed inset-y-0 left-0 z-50 w-64 bg-slate-900 text-slate-300 flex flex-col border-r border-slate-800 transition-transform duration-200 lg:static lg:translate-x-0 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="h-16 px-5 flex items-center justify-between border-b border-slate-800 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="h-8 w-8 rounded-lg bg-blue-600 flex items-center justify-center text-white shrink-0">
              <Printer className="h-4 w-4" />
            </div>
            <span className="font-display font-bold text-base text-white tracking-tight whitespace-nowrap truncate">
              Reffo PrintFlow
            </span>
          </div>
          <button
            type="button"
            onClick={() => setSidebarOpen(false)}
            className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-800 hover:text-white lg:hidden"
            aria-label="Tutup navigasi"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <nav className="flex-1 px-3 py-5 space-y-1 overflow-y-auto" aria-label="Menu utama">
          <p className="px-3 pb-1.5 text-xs font-medium text-slate-500">
            {ROLE_LABEL[user.role]}
          </p>
          {navItems.map((item) => {
            const active = activeNav === item.key;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => selectItem(item.key)}
                className={`w-full flex items-center justify-between gap-2.5 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  active
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-300 hover:bg-slate-800/80 hover:text-white'
                }`}
              >
                <span className="flex items-center gap-2.5 min-w-0">
                  <span className="shrink-0">{item.icon}</span>
                  <span className="truncate">{item.label}</span>
                </span>
                {typeof item.badge === 'number' && item.badge > 0 && (
                  <span
                    className={`font-mono tabular-nums text-xs px-1.5 py-0.5 rounded ${
                      active ? 'bg-blue-500 text-white' : 'bg-slate-800 text-slate-200'
                    }`}
                  >
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* Role Switcher & Active User Footer */}
        <div className="p-4 border-t border-slate-800 space-y-3 shrink-0">
          {demoSwitchEnabled && (
            <div>
              <label
                htmlFor="role-switcher"
                className="flex items-center gap-1.5 text-xs font-medium text-slate-400 mb-1.5"
              >
                <ArrowLeftRight className="h-3.5 w-3.5" />
                Ganti Divisi Aktif
              </label>
              <select
                id="role-switcher"
                value={user.id}
                onChange={(e) => {
                  const next = accounts.find((a) => a.id === Number(e.target.value));
                  if (next) onSwitchAccount(next);
                }}
                className="w-full rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-2 text-xs text-slate-100 focus:border-blue-500 focus:outline-none"
              >
                {accounts.map((acc) => (
                  <option key={acc.id} value={acc.id}>
                    {acc.name} · {ROLE_LABEL[acc.role]}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="flex items-center justify-between gap-2 pt-1">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-white truncate">{user.name}</p>
              <p className="text-xs text-slate-400 truncate">{user.email}</p>
            </div>
            <button
              type="button"
              onClick={onLogout}
              className="p-2 rounded-lg text-slate-400 hover:bg-slate-800 hover:text-white transition-colors shrink-0 cursor-pointer"
              title="Keluar"
              aria-label="Keluar"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Bar Contract: Breadcrumb Left, 1 Primary CTA Right */}
        <header className="no-print h-16 bg-white border-b border-slate-200 px-4 sm:px-6 flex items-center justify-between gap-8 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setSidebarOpen(true)}
              className="p-2 -ml-2 rounded-lg text-slate-600 hover:bg-slate-100 lg:hidden"
              aria-label="Buka menu"
            >
              <Menu className="h-5 w-5" />
            </button>
            <div className="flex items-center gap-2 text-sm min-w-0">
              {breadcrumbParent && (
                <>
                  <span className="text-slate-500 hidden sm:inline whitespace-nowrap">
                    {breadcrumbParent}
                  </span>
                  <span className="text-slate-300 hidden sm:inline" aria-hidden="true">
                    /
                  </span>
                </>
              )}
              <h1 className="font-display text-base sm:text-lg font-semibold text-slate-900 truncate">
                {pageTitle}
              </h1>
            </div>
          </div>

          {primaryAction && <div className="shrink-0">{primaryAction}</div>}
        </header>

        {/* Flash Alert */}
        {flash && (
          <div className="no-print px-4 sm:px-6 pt-4">
            <div
              role="status"
              className={`rounded-lg border px-4 py-3 flex items-center justify-between gap-4 text-sm ${
                flash.type === 'success'
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                  : 'border-rose-200 bg-rose-50 text-rose-900'
              }`}
            >
              <span>{flash.message}</span>
              <button
                type="button"
                onClick={onDismissFlash}
                className="text-xs font-medium underline hover:no-underline shrink-0 cursor-pointer"
              >
                Tutup
              </button>
            </div>
          </div>
        )}

        {/* Viewport Content */}
        <main className="flex-1 p-4 sm:p-6 max-w-7xl w-full mx-auto">{children}</main>
      </div>
    </div>
  );
};

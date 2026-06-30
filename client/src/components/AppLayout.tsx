import { useMemo, useState, useEffect } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Users, LogOut, ChevronDown, FileText, Settings as SettingsIcon,
  Plus, ListChecks, BarChart3, Layers, Building2, Factory, Inbox, ClipboardList,
  PanelLeftClose, Users2, Truck, PackageCheck, ShoppingCart, Activity, RotateCcw, Menu, X, ShieldAlert,
  Receipt, Clock, Wallet, TrendingUp, Calculator, CreditCard,
} from 'lucide-react';
import { useAuthStore, can, activeMembership } from '@/store/auth';
import type { PermissionKey } from '@/lib/permissions';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { CompanySwitcher } from '@/components/CompanySwitcher';

/* ---------- nav definition ---------- */
type NavLeaf = {
  kind: 'leaf'; to: string; label: string;
  icon: React.ComponentType<{ className?: string }>;
  end?: boolean;
  perm?: PermissionKey;
  platformOnly?: boolean;
};
type NavGroup = {
  kind: 'group'; key: string; label: string;
  icon: React.ComponentType<{ className?: string }>;
  children: NavLeaf[];
};
type NavItem = NavLeaf | NavGroup;

const NAV: NavItem[] = [
  { kind: 'leaf', to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { kind: 'leaf', to: '/analysis', label: 'Analysis', icon: TrendingUp, perm: 'manage_invoices' },
  {
    kind: 'group', key: 'po', label: 'Sales Order', icon: FileText,
    children: [
      { kind: 'leaf', to: '/po/new',     label: 'New Sales Order', icon: Plus,       perm: 'add_po' },
      { kind: 'leaf', to: '/po/manage',  label: 'SO Modify',       icon: ListChecks, perm: 'view_po' },
      { kind: 'leaf', to: '/po/summary', label: 'SO Summary',      icon: BarChart3,  perm: 'po_summary' },
    ],
  },
  {
    kind: 'group', key: 'production', label: 'Production', icon: Factory,
    children: [
      { kind: 'leaf', to: '/work-allotment',  label: 'Work Allotment', icon: ClipboardList, perm: 'assign_work' },
      { kind: 'leaf', to: '/production/new',  label: 'Receive',        icon: Inbox,         perm: 'rec_production' },
      { kind: 'leaf', to: '/production',      label: 'Modify',         icon: ClipboardList, perm: 'view_po' },
    ],
  },
  { kind: 'leaf', to: '/testing', label: 'Testing', icon: Calculator, perm: 'view_testing' },
  {
    kind: 'group', key: 'dispatch', label: 'Dispatch', icon: Truck,
    children: [
      { kind: 'leaf', to: '/dispatch/new', label: 'Dispatch',        icon: Truck,        perm: 'dispatch' },
      { kind: 'leaf', to: '/packing',      label: 'Packing',         icon: PackageCheck, perm: 'dispatch' },
      { kind: 'leaf', to: '/dispatch',     label: 'Modify Dispatch', icon: ClipboardList, perm: 'dispatch' },
    ],
  },
  { kind: 'leaf', to: '/returns', label: 'Return', icon: RotateCcw, perm: 'manage_returns' },
  {
    kind: 'group', key: 'accounts', label: 'Accounts', icon: Receipt,
    children: [
      { kind: 'leaf', to: '/sales-invoices',          label: 'Sales Register',    icon: FileText,     end: true, perm: 'manage_invoices' },
      { kind: 'leaf', to: '/accounts/purchases',      label: 'Purchase Register', icon: ShoppingCart, perm: 'manage_invoices' },
      { kind: 'leaf', to: '/accounts/bills-payable',  label: 'Bills Payable',     icon: CreditCard,   perm: 'manage_invoices' },
      { kind: 'leaf', to: '/sales-invoices/aging',    label: 'Debtor Aging',      icon: Clock,        perm: 'manage_invoices' },
      { kind: 'leaf', to: '/sales-invoices/payments', label: 'Receive Payments',  icon: Wallet,       perm: 'manage_invoices' },
      { kind: 'leaf', to: '/sales-invoices/bills-receivable', label: 'Bills Receivable', icon: Receipt, perm: 'manage_invoices' },
    ],
  },
  {
    kind: 'group', key: 'supplier-po', label: 'Supplier Order', icon: ShoppingCart,
    children: [
      { kind: 'leaf', to: '/supplier-po/new',    label: 'PO Order',  icon: Plus,       perm: 'add_supplier_po' },
      { kind: 'leaf', to: '/supplier-po/track',  label: 'Track PO',  icon: BarChart3,  perm: 'view_supplier_po' },
      { kind: 'leaf', to: '/supplier-po/manage', label: 'Modify PO', icon: ListChecks, perm: 'view_supplier_po' },
    ],
  },
  { kind: 'leaf', to: '/customers', label: 'Customers', icon: Users, perm: 'add_customer' },
  {
    kind: 'group', key: 'settings', label: 'Settings', icon: SettingsIcon,
    children: [
      { kind: 'leaf', to: '/settings/companies', label: 'Companies', icon: Building2, platformOnly: true },
      { kind: 'leaf', to: '/settings/users',     label: 'Users',     icon: Users,     perm: 'manage_users' },
      { kind: 'leaf', to: '/settings/materials',   label: 'Materials',   icon: Layers,   perm: 'add_material' },
      { kind: 'leaf', to: '/settings/flux-grades', label: 'Flux Grades', icon: Activity, perm: 'add_material' },
      { kind: 'leaf', to: '/settings/labours',   label: 'Workers',   icon: Users2,    perm: 'add_staff' },
      { kind: 'leaf', to: '/settings/suppliers', label: 'Suppliers', icon: Truck,     perm: 'add_supplier' },
      { kind: 'leaf', to: '/settings/data-cleanup', label: 'Data Cleanup', icon: ShieldAlert, perm: 'manage_users' },
    ],
  },
];

const findActiveGroupKey = (pathname: string): string | null => {
  for (const item of NAV) {
    if (item.kind !== 'group') continue;
    const hit = item.children.some((c) =>
      c.end ? pathname === c.to : pathname.startsWith(c.to)
    );
    if (hit) return item.key;
  }
  return null;
};

/* ---------- layout ---------- */
export const AppLayout = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, clear } = useAuthStore();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [openGroupKey, setOpenGroupKey] = useState<string | null>(
    () => findActiveGroupKey(location.pathname)
  );

  // Keep accordion in sync when user navigates (back/forward).
  useEffect(() => {
    const key = findActiveGroupKey(location.pathname);
    if (key) setOpenGroupKey(key);
  }, [location.pathname]);

  // Auto-close the mobile drawer whenever the user navigates somewhere new
  // — otherwise it stays open over the destination page.
  useEffect(() => { setMobileOpen(false); }, [location.pathname]);

  const logout = async () => {
    await api('/auth/logout', { method: 'POST' }).catch(() => {});
    clear();
    navigate('/login');
  };

  const isPlatform = !!user?.isPlatformAdmin;
  const isVisible = (n: NavLeaf) => {
    if (n.platformOnly && !isPlatform) return false;
    return can(n.perm);
  };
  const visibleNav = useMemo<NavItem[]>(
    () => NAV.flatMap((item): NavItem[] => {
      if (item.kind === 'leaf') return isVisible(item) ? [item] : [];
      const kids = item.children.filter(isVisible);
      return kids.length ? [{ ...item, children: kids }] : [];
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [user?.id, isPlatform, useAuthStore.getState().activePermissions.join(','), useAuthStore.getState().activeRole]
  );

  const toggleGroup = (key: string) =>
    setOpenGroupKey((prev) => (prev === key ? null : key));

  return (
    <div className="flex min-h-screen bg-slate-50 print:block">
      {/* Mobile backdrop — only visible when the drawer is open */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/50 backdrop-blur-sm md:hidden"
          onClick={() => setMobileOpen(false)}
          aria-hidden
        />
      )}

      {/* Sidebar — fixed drawer on mobile, normal flex column on md+ */}
      <aside
        className={cn(
          'shrink-0 flex-col bg-ink-900 text-white overflow-hidden print:!hidden',
          'transition-[width,transform] duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]',
          // Mobile: fixed overlay that slides in from the left.
          'fixed inset-y-0 left-0 z-40 flex w-64',
          mobileOpen ? 'translate-x-0' : '-translate-x-full',
          // md+ : in-flow column, width follows the collapsed toggle.
          'md:static md:translate-x-0 md:flex',
          collapsed ? 'md:w-16' : 'md:w-64'
        )}
      >
        {/* Top bar — just the collapse / close toggle now. The Metflux brand
            block was removed; the CompanySwitcher below carries the active
            company's identity, and the collapsed rail stays intentionally
            bare so the nav icons get all the focus. */}
        <div className="flex items-center justify-end border-b border-white/5 px-4 py-4 min-w-0">
          {/* Mobile: close-drawer X. Desktop: collapse/expand toggle. */}
          <button
            onClick={() => {
              if (window.matchMedia('(min-width: 768px)').matches) {
                setCollapsed((v) => !v);
              } else {
                setMobileOpen(false);
              }
            }}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className={cn(
              'shrink-0 rounded p-1 text-white/40 hover:bg-white/10 hover:text-white transition-colors',
              collapsed ? 'ml-0' : 'ml-auto'
            )}
          >
            <X className="h-4 w-4 md:hidden" />
            <PanelLeftClose
              className={cn(
                'hidden md:block h-4 w-4 transition-transform duration-300',
                collapsed ? 'rotate-180' : 'rotate-0'
              )}
            />
          </button>
        </div>

        {/* overflow-hidden only when collapsed so the open dropdown isn't clipped */}
        <div
          className={cn(
            'border-b border-white/5 px-3 py-3',
            'transition-[opacity,max-height,padding] duration-200',
            collapsed
              ? 'overflow-hidden opacity-0 max-h-0 py-0 pointer-events-none'
              : 'opacity-100 max-h-24 delay-75'
          )}
        >
          <CompanySwitcher />
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto px-2 py-3">
          {visibleNav.map((item) =>
            item.kind === 'leaf' ? (
              <SidebarLink key={item.to} item={item} collapsed={collapsed} />
            ) : (
              <SidebarGroup
                key={item.key}
                item={item}
                collapsed={collapsed}
                isOpen={openGroupKey === item.key}
                onToggle={() => toggleGroup(item.key)}
              />
            )
          )}
        </nav>

        {/* User card */}
        <div className="border-t border-white/5 p-3">
          <div
            className={cn(
              'overflow-hidden whitespace-nowrap',
              'transition-[opacity,max-height,margin] duration-200',
              collapsed ? 'opacity-0 max-h-0 mb-0' : 'opacity-100 max-h-16 mb-2 delay-75'
            )}
          >
            <div className="flex items-center gap-2.5 rounded-lg bg-white/5 px-3 py-2">
              <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand-500/20 text-brand-300 text-xs font-semibold">
                {user?.name?.[0]?.toUpperCase() ?? '?'}
              </div>
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{user?.name}</div>
                <div className="truncate text-[11px] text-white/50">@{user?.username}</div>
              </div>
            </div>
          </div>
          <button
            onClick={logout}
            title="Sign out"
            className={cn(
              'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-white/70 transition hover:bg-white/5 hover:text-white',
              collapsed && 'justify-center'
            )}
          >
            <LogOut className="h-4 w-4 shrink-0" />
            {!collapsed && 'Sign out'}
          </button>
        </div>
      </aside>

      <main className="flex flex-1 flex-col min-w-0 print:block">
        <PageHeader
          onToggleSidebar={() => {
            // Mobile: open/close the drawer. Desktop: collapse/expand the column.
            if (window.matchMedia('(min-width: 768px)').matches) {
              setCollapsed((v) => !v);
            } else {
              setMobileOpen((v) => !v);
            }
          }}
        />
        <div className="flex-1 p-4 sm:p-6 print:p-0">
          <Outlet />
        </div>
      </main>
    </div>
  );
};

/* ---------- sidebar leaf link ---------- */
const SidebarLink = ({ item, collapsed }: { item: NavLeaf; collapsed: boolean }) => {
  const Icon = item.icon;
  return (
    <NavLink
      to={item.to}
      end={item.end}
      title={collapsed ? item.label : undefined}
      className={({ isActive }) =>
        cn(
          'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition',
          collapsed && 'justify-center',
          isActive
            ? 'bg-brand-500/15 text-brand-300 ring-1 ring-brand-500/30'
            : 'text-white/70 hover:bg-white/5 hover:text-white'
        )
      }
    >
      <Icon className="h-4 w-4 shrink-0" />
      {!collapsed && item.label}
    </NavLink>
  );
};

/* ---------- sidebar collapsible group ---------- */
const SidebarGroup = ({
  item, collapsed, isOpen, onToggle,
}: {
  item: NavGroup;
  collapsed: boolean;
  isOpen: boolean;
  onToggle: () => void;
}) => {
  const location = useLocation();
  const containsActive = item.children.some((c) =>
    c.end ? location.pathname === c.to : location.pathname.startsWith(c.to)
  );
  const Icon = item.icon;

  // In icon-only mode, render a plain link to the first child (or just the icon).
  if (collapsed) {
    return (
      <div title={item.label}>
        <NavLink
          to={item.children[0]?.to ?? '#'}
          className={cn(
            'flex justify-center rounded-lg px-3 py-2 text-sm font-medium transition',
            containsActive ? 'bg-brand-500/15 text-brand-300' : 'text-white/70 hover:bg-white/5 hover:text-white'
          )}
        >
          <Icon className="h-4 w-4 shrink-0" />
        </NavLink>
      </div>
    );
  }

  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        className={cn(
          'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition',
          containsActive ? 'text-white' : 'text-white/70 hover:bg-white/5 hover:text-white'
        )}
      >
        <Icon className="h-4 w-4 shrink-0" />
        <span className="flex-1 text-left">{item.label}</span>
        <ChevronDown className={cn('h-4 w-4 transition-transform', isOpen ? 'rotate-180' : '')} />
      </button>
      {isOpen && (
        <div className="ml-4 mt-1 space-y-1 border-l border-white/10 pl-3">
          {item.children.map((child) => {
            const ChildIcon = child.icon;
            return (
              <NavLink
                key={child.to}
                to={child.to}
                end={child.end}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition',
                    isActive
                      ? 'bg-brand-500/15 text-brand-300'
                      : 'text-white/60 hover:bg-white/5 hover:text-white'
                  )
                }
              >
                <ChildIcon className="h-3.5 w-3.5 shrink-0" />
                {child.label}
              </NavLink>
            );
          })}
        </div>
      )}
    </div>
  );
};

/* ---------- page header ---------- */
const PageHeader = ({ onToggleSidebar }: { onToggleSidebar: () => void }) => {
  const { user } = useAuthStore();
  const active = useAuthStore(activeMembership);
  // Show only the first word of the company name (e.g. "Lakshay Steel Industries" → "Lakshay").
  const firstWord = (active?.companyName ?? 'Metflux').trim().split(/\s+/)[0];
  return (
    <header className="page-header flex items-center justify-between border-b border-slate-200 bg-white/70 px-3 sm:px-6 py-3 backdrop-blur print:hidden">
      <div className="flex items-center gap-2.5 min-w-0">
        {/* Sidebar toggle — mobile drawer open/close, desktop collapse/expand. */}
        <button
          type="button"
          onClick={onToggleSidebar}
          aria-label="Toggle navigation menu"
          title="Toggle navigation menu"
          className="grid h-9 w-9 place-items-center rounded-lg text-slate-600 hover:bg-slate-100 transition-colors shrink-0"
        >
          <Menu className="h-5 w-5" />
        </button>
        {active?.companyLogoUrl && (
          <img
            src={active.companyLogoUrl}
            alt={firstWord}
            className="h-7 w-7 rounded object-contain shrink-0"
          />
        )}
        <span className="font-semibold text-slate-900 text-sm sm:text-base truncate">{firstWord}</span>
      </div>
      <div className="text-sm text-slate-500 truncate ml-2">
        {user?.name}
        {user?.isPlatformAdmin && (
          <span className="ml-1.5 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">
            PLATFORM
          </span>
        )}
      </div>
    </header>
  );
};

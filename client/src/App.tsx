import { useEffect, lazy, Suspense, type ComponentType } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useBranding } from '@/store/branding';
import { AppLayout } from '@/components/AppLayout';
import { RequireAuth } from '@/components/RequireAuth';

// Route-level code splitting: each page is its own chunk, loaded on demand, so
// the initial download is just the app shell (not every screen + html2pdf +
// xlsx). Massively smaller first load, especially on a hard refresh.
const page = (loader: () => Promise<Record<string, unknown>>, key: string) =>
  lazy(async () => {
    try {
      const mod = await loader();
      // A chunk loaded fine — clear any prior stale-chunk reload guard.
      try { sessionStorage.removeItem('chunkReload'); } catch { /* ignore */ }
      return { default: mod[key] as ComponentType };
    } catch (err) {
      // A new deploy invalidates old chunk URLs a cached shell still points at.
      // Reload ONCE (guarded, so a genuinely-missing chunk can't loop) to pick
      // up the fresh shell + chunk hashes.
      try {
        if (!sessionStorage.getItem('chunkReload')) {
          sessionStorage.setItem('chunkReload', '1');
          window.location.reload();
        }
      } catch { /* ignore */ }
      throw err;
    }
  });

const AuthPage            = page(() => import('@/pages/AuthPage'), 'AuthPage');
const DashboardPage       = page(() => import('@/pages/DashboardPage'), 'DashboardPage');
const CustomersPage       = page(() => import('@/pages/CustomersPage'), 'CustomersPage');
const CustomerFormPage    = page(() => import('@/pages/CustomerFormPage'), 'CustomerFormPage');
const UsersListPage       = page(() => import('@/pages/UsersListPage'), 'UsersListPage');
const UserFormPage        = page(() => import('@/pages/UserFormPage'), 'UserFormPage');
const MaterialsPage       = page(() => import('@/pages/MaterialsPage'), 'MaterialsPage');
const FluxGradesPage      = page(() => import('@/pages/FluxGradesPage'), 'FluxGradesPage');
const CompaniesListPage   = page(() => import('@/pages/CompaniesListPage'), 'CompaniesListPage');
const CompanyFormPage     = page(() => import('@/pages/CompanyFormPage'), 'CompanyFormPage');
const POOrderNewPage      = page(() => import('@/pages/POOrderNewPage'), 'POOrderNewPage');
const QuotationNewPage    = page(() => import('@/pages/QuotationNewPage'), 'QuotationNewPage');
const QuotationsPage      = page(() => import('@/pages/QuotationsPage'), 'QuotationsPage');
const QuotationPrintPage  = page(() => import('@/pages/QuotationPrintPage'), 'QuotationPrintPage');
const POManagePage        = page(() => import('@/pages/POManagePage'), 'POManagePage');
const POEditPage          = page(() => import('@/pages/POEditPage'), 'POEditPage');
const POOrderEditPage     = page(() => import('@/pages/POOrderEditPage'), 'POOrderEditPage');
const SOSummaryPage       = page(() => import('@/pages/SOSummaryPage'), 'SOSummaryPage');
const SuppliersPage       = page(() => import('@/pages/SuppliersPage'), 'SuppliersPage');
const SupplierFormPage    = page(() => import('@/pages/SupplierFormPage'), 'SupplierFormPage');
const SupplierOrderNewPage    = page(() => import('@/pages/SupplierOrderNewPage'), 'SupplierOrderNewPage');
const SupplierOrderManagePage = page(() => import('@/pages/SupplierOrderManagePage'), 'SupplierOrderManagePage');
const SupplierOrderEditPage   = page(() => import('@/pages/SupplierOrderEditPage'), 'SupplierOrderEditPage');
const SupplierOrderTrackPage  = page(() => import('@/pages/SupplierOrderTrackPage'), 'SupplierOrderTrackPage');
const SupplierPOPrintPage     = page(() => import('@/pages/SupplierPOPrintPage'), 'SupplierPOPrintPage');
const ProductionListPage    = page(() => import('@/pages/ProductionListPage'), 'ProductionListPage');
const ProductionSummaryPage = page(() => import('@/pages/ProductionSummaryPage'), 'ProductionSummaryPage');
const ProductionNewPage     = page(() => import('@/pages/ProductionNewPage'), 'ProductionNewPage');
const ProductionEditPage    = page(() => import('@/pages/ProductionEditPage'), 'ProductionEditPage');
const RejectionPage         = page(() => import('@/pages/RejectionPage'), 'RejectionPage');
const JournalRegisterPage   = page(() => import('@/pages/JournalRegisterPage'), 'JournalRegisterPage');
const NotificationsPage     = page(() => import('@/pages/NotificationsPage'), 'NotificationsPage');
const DispatchListPage    = page(() => import('@/pages/DispatchListPage'), 'DispatchListPage');
const DispatchNewPage     = page(() => import('@/pages/DispatchNewPage'), 'DispatchNewPage');
const DispatchEditPage    = page(() => import('@/pages/DispatchEditPage'), 'DispatchEditPage');
const PackingPage         = page(() => import('@/pages/PackingPage'), 'PackingPage');
const WarehousePage       = page(() => import('@/pages/WarehousePage'), 'WarehousePage');
const PackingListPage     = page(() => import('@/pages/PackingListPage'), 'PackingListPage');
const LaboursPage         = page(() => import('@/pages/LaboursPage'), 'LaboursPage');
const LabourFormPage      = page(() => import('@/pages/LabourFormPage'), 'LabourFormPage');
const WorkAllotmentPage      = page(() => import('@/pages/WorkAllotmentPage'), 'WorkAllotmentPage');
const WorkAllotmentBuildPage = page(() => import('@/pages/WorkAllotmentBuildPage'), 'WorkAllotmentBuildPage');
const ReturnsListPage     = page(() => import('@/pages/ReturnsListPage'), 'ReturnsListPage');
const ReturnFormPage      = page(() => import('@/pages/ReturnFormPage'), 'ReturnFormPage');
const TestingReportPage   = page(() => import('@/pages/TestingReportPage'), 'TestingReportPage');
const SalesInvoicesPage   = page(() => import('@/pages/SalesInvoicesPage'), 'SalesInvoicesPage');
const DebtorAgingPage     = page(() => import('@/pages/DebtorAgingPage'), 'DebtorAgingPage');
const ReceivePaymentsPage = page(() => import('@/pages/ReceivePaymentsPage'), 'ReceivePaymentsPage');
const ReceiptsPaymentsPage = page(() => import('@/pages/ReceiptsPaymentsPage'), 'ReceiptsPaymentsPage');
const CashbookSummaryPage = page(() => import('@/pages/CashbookSummaryPage'), 'CashbookSummaryPage');
const CreditorAgingPage   = page(() => import('@/pages/CreditorAgingPage'), 'CreditorAgingPage');
const DataCleanupPage     = page(() => import('@/pages/DataCleanupPage'), 'DataCleanupPage');
const UserLogsPage        = page(() => import('@/pages/UserLogsPage'), 'UserLogsPage');
const AuditLogPage        = page(() => import('@/pages/AuditLogPage'), 'AuditLogPage');
const CustomerPortalPage  = page(() => import('@/pages/CustomerPortalPage'), 'CustomerPortalPage');
const BusinessAnalysisPage = page(() => import('@/pages/BusinessAnalysisPage'), 'BusinessAnalysisPage');
const TestingCalculatorPage = page(() => import('@/pages/TestingCalculatorPage'), 'TestingCalculatorPage');
const PurchasesPage       = page(() => import('@/pages/PurchasesPage'), 'PurchasesPage');
const BrandingPage        = page(() => import('@/pages/BrandingPage'), 'BrandingPage');

const Loading = () => (
  <div className="flex h-screen items-center justify-center text-slate-400">Loading…</div>
);

export const App = () => {
  const loadBranding = useBranding((s) => s.load);
  useEffect(() => { loadBranding(); }, [loadBranding]);
  return (
  <Suspense fallback={<Loading />}>
  <Routes>
    <Route path="/login"            element={<AuthPage />} />
    <Route path="/portal/:token"   element={<CustomerPortalPage />} />
    <Route
      element={
        <RequireAuth>
          <AppLayout />
        </RequireAuth>
      }
    >
      <Route path="/" element={<DashboardPage />} />
      <Route path="/analysis" element={<BusinessAnalysisPage />} />

      {/* PO Order group */}
      <Route path="/po/new"          element={<POOrderNewPage />} />
      <Route path="/po/new/:poId"    element={<POOrderNewPage />} />
      <Route path="/po/manage"       element={<POManagePage />} />
      <Route path="/po/manage/:id"   element={<POEditPage />} />
      <Route path="/po/edit/:poId"   element={<POOrderEditPage />} />
      <Route path="/po/summary"      element={<SOSummaryPage />} />
      <Route path="/quotation/new"        element={<QuotationNewPage />} />
      <Route path="/quotation/manage"     element={<QuotationsPage />} />
      <Route path="/quotation/:id/print"  element={<QuotationPrintPage />} />

      {/* Production */}
      <Route path="/production"          element={<ProductionListPage />} />
      <Route path="/production/summary"  element={<ProductionSummaryPage />} />
      <Route path="/production/new"  element={<ProductionNewPage />} />
      <Route path="/production/rejection" element={<RejectionPage />} />
      <Route path="/production/:id"  element={<ProductionEditPage />} />

      {/* Dispatch */}
      <Route path="/dispatch"        element={<DispatchListPage />} />
      <Route path="/dispatch/new"    element={<DispatchNewPage />} />
      <Route path="/dispatch/warehouse" element={<WarehousePage />} />
      <Route path="/dispatch/:id"    element={<DispatchEditPage />} />

      {/* Testing calculator */}
      <Route path="/testing"        element={<TestingCalculatorPage />} />

      {/* Packing */}
      <Route path="/packing"        element={<PackingPage />} />
      <Route path="/packing-list"   element={<PackingListPage />} />
      <Route path="/testing-report" element={<TestingReportPage />} />

      {/* Work Allotment */}
      <Route path="/work-allotment"     element={<WorkAllotmentPage />} />
      <Route path="/work-allotment/new" element={<WorkAllotmentBuildPage />} />

      {/* Returns */}
      <Route path="/returns"     element={<ReturnsListPage />} />
      <Route path="/returns/new" element={<ReturnFormPage />} />
      <Route path="/returns/:id" element={<ReturnFormPage />} />

      {/* Sales Invoices */}
      <Route path="/sales-invoices"          element={<SalesInvoicesPage />} />
      <Route path="/sales-invoices/aging"    element={<DebtorAgingPage />} />
      <Route path="/sales-invoices/payments" element={<ReceivePaymentsPage />} />
      <Route path="/accounts/receipts-payments" element={<ReceiptsPaymentsPage />} />
      <Route path="/accounts/cashbook-summary" element={<CashbookSummaryPage />} />
      <Route path="/accounts/journal" element={<JournalRegisterPage />} />
      <Route path="/notifications" element={<NotificationsPage />} />
      <Route path="/accounts/purchases"      element={<PurchasesPage />} />
      <Route path="/accounts/creditor-aging" element={<CreditorAgingPage />} />

      {/* Supplier Order group */}
      <Route path="/supplier-po/new"          element={<SupplierOrderNewPage />} />
      <Route path="/supplier-po/track"        element={<SupplierOrderTrackPage />} />
      <Route path="/supplier-po/manage"       element={<SupplierOrderManagePage />} />
      <Route path="/supplier-po/manage/:id"   element={<SupplierOrderEditPage />} />
      <Route path="/supplier-po/print/:id"    element={<SupplierPOPrintPage />} />

      <Route path="/customers"      element={<CustomersPage />} />
      <Route path="/customers/new"  element={<CustomerFormPage />} />
      <Route path="/customers/:id"  element={<CustomerFormPage />} />

      {/* Settings group */}
      <Route path="/settings/users"      element={<UsersListPage />} />
      <Route path="/settings/users/new"  element={<UserFormPage />} />
      <Route path="/settings/users/:id"  element={<UserFormPage />} />
      <Route path="/settings/materials"     element={<MaterialsPage />} />
      <Route path="/settings/flux-grades"   element={<FluxGradesPage />} />
      <Route path="/settings/labours"        element={<LaboursPage />} />
      <Route path="/settings/labours/new"    element={<LabourFormPage />} />
      <Route path="/settings/labours/:id"    element={<LabourFormPage />} />
      <Route path="/settings/companies"     element={<CompaniesListPage />} />
      <Route path="/settings/companies/new" element={<CompanyFormPage />} />
      <Route path="/settings/companies/:id" element={<CompanyFormPage />} />
      <Route path="/settings/suppliers"     element={<SuppliersPage />} />
      <Route path="/settings/suppliers/new" element={<SupplierFormPage />} />
      <Route path="/settings/suppliers/:id" element={<SupplierFormPage />} />
      <Route path="/settings/data-cleanup"  element={<DataCleanupPage />} />
      <Route path="/settings/user-logs"     element={<UserLogsPage />} />
      <Route path="/settings/audit-log"     element={<AuditLogPage />} />
      <Route path="/settings/branding"      element={<BrandingPage />} />
    </Route>
    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes>
  </Suspense>
  );
};

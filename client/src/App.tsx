import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthPage } from '@/pages/AuthPage';
import { DashboardPage } from '@/pages/DashboardPage';
import { CustomersPage } from '@/pages/CustomersPage';
import { CustomerFormPage } from '@/pages/CustomerFormPage';
import { UsersListPage } from '@/pages/UsersListPage';
import { UserFormPage } from '@/pages/UserFormPage';
import { MaterialsPage } from '@/pages/MaterialsPage';
import { FluxGradesPage } from '@/pages/FluxGradesPage';
import { CompaniesListPage } from '@/pages/CompaniesListPage';
import { CompanyFormPage } from '@/pages/CompanyFormPage';
import { POOrderNewPage } from '@/pages/POOrderNewPage';
import { POManagePage } from '@/pages/POManagePage';
import { POEditPage } from '@/pages/POEditPage';
import { POOrderEditPage } from '@/pages/POOrderEditPage';
import { SOSummaryPage } from '@/pages/SOSummaryPage';
import { SuppliersPage } from '@/pages/SuppliersPage';
import { SupplierFormPage } from '@/pages/SupplierFormPage';
import { SupplierOrderNewPage } from '@/pages/SupplierOrderNewPage';
import { SupplierOrderManagePage } from '@/pages/SupplierOrderManagePage';
import { SupplierOrderEditPage } from '@/pages/SupplierOrderEditPage';
import { SupplierOrderTrackPage } from '@/pages/SupplierOrderTrackPage';
import { SupplierPOPrintPage } from '@/pages/SupplierPOPrintPage';
import { ProductionListPage } from '@/pages/ProductionListPage';
import { ProductionNewPage } from '@/pages/ProductionNewPage';
import { ProductionEditPage } from '@/pages/ProductionEditPage';
import { DispatchListPage } from '@/pages/DispatchListPage';
import { DispatchNewPage } from '@/pages/DispatchNewPage';
import { DispatchEditPage } from '@/pages/DispatchEditPage';
import { PackingPage } from '@/pages/PackingPage';
import { PackingListPage } from '@/pages/PackingListPage';
import { LaboursPage } from '@/pages/LaboursPage';
import { LabourFormPage } from '@/pages/LabourFormPage';
import { WorkAllotmentPage } from '@/pages/WorkAllotmentPage';
import { WorkAllotmentBuildPage } from '@/pages/WorkAllotmentBuildPage';
import { ReturnsListPage } from '@/pages/ReturnsListPage';
import { ReturnFormPage } from '@/pages/ReturnFormPage';
import { TestingReportPage } from '@/pages/TestingReportPage';
import { DataCleanupPage } from '@/pages/DataCleanupPage';
import { CustomerPortalPage } from '@/pages/CustomerPortalPage';
import { AppLayout } from '@/components/AppLayout';
import { RequireAuth } from '@/components/RequireAuth';

export const App = () => (
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

      {/* PO Order group */}
      <Route path="/po/new"          element={<POOrderNewPage />} />
      <Route path="/po/manage"       element={<POManagePage />} />
      <Route path="/po/manage/:id"   element={<POEditPage />} />
      <Route path="/po/edit/:poId"   element={<POOrderEditPage />} />
      <Route path="/po/summary"      element={<SOSummaryPage />} />

      {/* Production */}
      <Route path="/production"      element={<ProductionListPage />} />
      <Route path="/production/new"  element={<ProductionNewPage />} />
      <Route path="/production/:id"  element={<ProductionEditPage />} />

      {/* Dispatch */}
      <Route path="/dispatch"        element={<DispatchListPage />} />
      <Route path="/dispatch/new"    element={<DispatchNewPage />} />
      <Route path="/dispatch/:id"    element={<DispatchEditPage />} />

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
    </Route>
    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes>
);

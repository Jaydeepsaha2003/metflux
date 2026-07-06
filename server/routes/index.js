// Mounts every /api/* sub-router. Add new resources here.
import { Router } from 'express';
import { apiLimiter } from '../lib/rateLimit.js';
import authRouter from './auth.js';
import usersRouter from './users.js';
import companiesRouter from './companies.js';
import customersRouter from './customers.js';
import suppliersRouter from './suppliers.js';
import poOrdersRouter from './poOrders.js';
import supplierOrdersRouter from './supplierOrders.js';
import productionRouter from './production.js';
import dispatchRouter from './dispatch.js';
import packingListsRouter from './packingLists.js';
import workAllotmentsRouter from './workAllotments.js';
import laboursRouter from './labours.js';
import payrollRouter from './payroll.js';
import materialGradesRouter from './materialGrades.js';
import salesInvoicesRouter from './salesInvoices.js';
import purchasesRouter from './purchases.js';
import paymentsRouter from './payments.js';
import receiptsPaymentsRouter from './receiptsPayments.js';
import cashbookRouter from './cashbook.js';
import warehousesRouter from './warehouses.js';
import emailRouter from './email.js';
import auditRouter from './audit.js';
import fluxGradesRouter from './fluxGrades.js';
import pushRouter from './push.js';
import whatsappRouter from './whatsapp.js';
import shareRouter from './share.js';
import returnsRouter from './returns.js';
import dashboardRouter from './dashboard.js';
import adminRouter from './admin.js';
import appSettingsRouter from './appSettings.js';
import publicRouter from './public.js';
import customerPortalRouter from './customerPortal.js';

export const apiRouter = Router();

apiRouter.use(apiLimiter);

// Public, unauthenticated endpoints — must come BEFORE any router that uses
// requireAuth at the module level. Has its own per-IP rate limit inside.
apiRouter.use('/public',  publicRouter);
apiRouter.use('/portal',  customerPortalRouter);

apiRouter.use('/auth', authRouter);
apiRouter.use('/users', usersRouter);
apiRouter.use('/companies', companiesRouter);
apiRouter.use('/customers', customersRouter);
apiRouter.use('/suppliers', suppliersRouter);
apiRouter.use('/po-orders', poOrdersRouter);
apiRouter.use('/supplier-orders', supplierOrdersRouter);
apiRouter.use('/production', productionRouter);
apiRouter.use('/dispatch', dispatchRouter);
apiRouter.use('/packing-lists', packingListsRouter);
apiRouter.use('/work-allotments', workAllotmentsRouter);
apiRouter.use('/labours', laboursRouter);
apiRouter.use('/payroll', payrollRouter);
apiRouter.use('/material-grades', materialGradesRouter);
apiRouter.use('/sales-invoices', salesInvoicesRouter);
apiRouter.use('/purchases', purchasesRouter);
apiRouter.use('/payments', paymentsRouter);
apiRouter.use('/receipts-payments', receiptsPaymentsRouter);
apiRouter.use('/cashbook', cashbookRouter);
apiRouter.use('/warehouses', warehousesRouter);
apiRouter.use('/email', emailRouter);
apiRouter.use('/audit', auditRouter);
apiRouter.use('/flux-grades', fluxGradesRouter);
apiRouter.use('/push', pushRouter);
apiRouter.use('/whatsapp', whatsappRouter);
apiRouter.use('/share', shareRouter);
apiRouter.use('/returns', returnsRouter);
apiRouter.use('/dashboard', dashboardRouter);
apiRouter.use('/admin', adminRouter);
apiRouter.use('/app-settings', appSettingsRouter);

apiRouter.get('/', (_req, res) => {
  res.json({
    name: 'metflux-api',
    version: '0.1.0',
    routes: ['/auth', '/users', '/companies', '/customers', '/po-orders', '/production', '/labours', '/material-grades', '/push', '/whatsapp'],
  });
});

-- =====================================================================
-- Metflux — full database schema (MySQL 8 / MariaDB)
-- =====================================================================
-- USAGE
--   1. Open phpMyAdmin → select your empty database (or create one).
--   2. Click the "Import" tab → choose this file → Go.
--   3. After import, log into the app once with the seed admin user
--      (see "FIRST-RUN ADMIN" at the bottom of this file).
--
-- NOTES
--   - Charset is utf8mb4 / utf8mb4_unicode_ci (full Unicode support).
--   - All `id` columns are VARCHAR(191) and hold app-generated string IDs
--     (UUID v4 via uuid package) — do NOT change to AUTO_INCREMENT.
--   - This file CREATES tables; it does NOT drop them. If you need to
--     re-import, drop the database (or all tables) first in phpMyAdmin.
--
-- HOW TO ADD A COLUMN LATER (manual update workflow)
--   1. In phpMyAdmin: ALTER TABLE `MyTable` ADD COLUMN `myCol` ...
--   2. Use the column in your route SQL via the helpers in server/lib/db.js
--      (q, qOne, insert, update, del, txn).
--   No client regeneration step — the SQL is the source of truth.
-- =====================================================================

-- CreateTable
CREATE TABLE `Company` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(160) NOT NULL,
    `slug` VARCHAR(80) NOT NULL,
    `gstNumber` VARCHAR(40) NULL,
    `address` VARCHAR(400) NULL,
    `phone` VARCHAR(40) NULL,
    `whatsappNumber` VARCHAR(40) NULL,
    `email` VARCHAR(160) NULL,
    `logoUrl` MEDIUMTEXT NULL,
    `defaultShareTarget` ENUM('PROMPT', 'CUSTOMER', 'COMPANY') NOT NULL DEFAULT 'PROMPT',
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Company_slug_key`(`slug`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `User` (
    `id` VARCHAR(191) NOT NULL,
    `email` VARCHAR(160) NOT NULL,
    `username` VARCHAR(40) NOT NULL,
    `passwordHash` VARCHAR(120) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `isPlatformAdmin` BOOLEAN NOT NULL DEFAULT false,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `User_email_key`(`email`),
    UNIQUE INDEX `User_username_key`(`username`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Membership` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `companyId` VARCHAR(191) NOT NULL,
    `role` ENUM('COMPANY_ADMIN', 'MANAGER', 'STAFF') NOT NULL DEFAULT 'STAFF',
    `permissions` JSON NOT NULL,
    `isPrimary` BOOLEAN NOT NULL DEFAULT false,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `hideCustomerNames` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Membership_companyId_idx`(`companyId`),
    INDEX `Membership_userId_idx`(`userId`),
    UNIQUE INDEX `Membership_userId_companyId_key`(`userId`, `companyId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `RefreshToken` (
    `jti` VARCHAR(40) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `revokedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `RefreshToken_userId_idx`(`userId`),
    PRIMARY KEY (`jti`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Customer` (
    `id` VARCHAR(191) NOT NULL,
    `customerCode` VARCHAR(40) NOT NULL,
    `name` VARCHAR(160) NOT NULL,
    `email` VARCHAR(160) NULL,
    `phone` VARCHAR(40) NULL,
    `address` VARCHAR(400) NULL,
    `gstNumber` VARCHAR(40) NULL,
    `gstRate` DOUBLE NOT NULL DEFAULT 0,
    `state` VARCHAR(80) NULL,
    `dueDays` INTEGER NULL,
    `notes` TEXT NULL,
    `shareToken` VARCHAR(64) NULL,
    -- Customer portal login. portalPasswordHash is the bcrypt of the current
    -- password; portalPasswordSet flips to 1 once the customer picks their own
    -- (until then the initial password must be changed on first login).
    -- portalInitialPassword keeps the plaintext temp password so an admin can
    -- re-share it — cleared the moment the customer sets their own.
    -- portalShortCode powers the /p/<code> shareable short link.
    `portalPasswordHash` VARCHAR(191) NULL,
    `portalPasswordSet` TINYINT(1) NOT NULL DEFAULT 0,
    `portalInitialPassword` VARCHAR(64) NULL,
    `portalShortCode` VARCHAR(16) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `companyId` VARCHAR(191) NOT NULL,
    `createdById` VARCHAR(191) NULL,

    INDEX `Customer_companyId_createdAt_idx`(`companyId`, `createdAt`),
    INDEX `Customer_companyId_name_idx`(`companyId`, `name`),
    UNIQUE INDEX `Customer_companyId_customerCode_key`(`companyId`, `customerCode`),
    UNIQUE INDEX `Customer_portalShortCode_key`(`portalShortCode`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `FluxGrade` (
    `id` VARCHAR(191) NOT NULL,
    `grade` VARCHAR(80) NOT NULL,
    `flux` DOUBLE NOT NULL,
    `coreType` ENUM('TOROIDAL', 'RECTANGULAR') NOT NULL DEFAULT 'TOROIDAL',
    `ateCm` DOUBLE NOT NULL,
    `notes` VARCHAR(200) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `companyId` VARCHAR(191) NOT NULL,

    INDEX `FluxGrade_companyId_grade_idx`(`companyId`, `grade`),
    INDEX `FluxGrade_companyId_coreType_idx`(`companyId`, `coreType`),
    UNIQUE INDEX `FluxGrade_companyId_grade_flux_coreType_key`(`companyId`, `grade`, `flux`, `coreType`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MaterialGrade` (
    `id` VARCHAR(191) NOT NULL,
    `grade` VARCHAR(80) NOT NULL,
    `material` VARCHAR(120) NOT NULL,
    `coreTypes` VARCHAR(60) NULL,
    `nanoIdOff` DOUBLE NULL,
    `nanoOdOff` DOUBLE NULL,
    `nanoHtOff` DOUBLE NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `companyId` VARCHAR(191) NOT NULL,

    INDEX `MaterialGrade_companyId_grade_idx`(`companyId`, `grade`),
    UNIQUE INDEX `MaterialGrade_companyId_grade_material_key`(`companyId`, `grade`, `material`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PoOrder` (
    `id` VARCHAR(191) NOT NULL,
    `poNumber` VARCHAR(60) NOT NULL,
    `orderDate` DATETIME(3) NOT NULL,
    `deliveryDays` INTEGER NOT NULL DEFAULT 0,
    `deliveryDate` DATETIME(3) NOT NULL,
    `notes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `companyId` VARCHAR(191) NOT NULL,
    `customerId` VARCHAR(191) NOT NULL,
    `createdById` VARCHAR(191) NULL,

    INDEX `PoOrder_companyId_createdAt_idx`(`companyId`, `createdAt`),
    INDEX `PoOrder_customerId_idx`(`customerId`),
    UNIQUE INDEX `PoOrder_companyId_poNumber_key`(`companyId`, `poNumber`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PoOrderItem` (
    `id` VARCHAR(191) NOT NULL,
    `poOrderId` VARCHAR(191) NOT NULL,
    `coreType` ENUM('TOROIDAL', 'RECTANGULAR', 'NANO') NOT NULL,
    `grade` VARCHAR(80) NOT NULL,
    `material` VARCHAR(120) NOT NULL,
    `measure` VARCHAR(160) NOT NULL,
    `id1` DOUBLE NOT NULL,
    `id2` DOUBLE NULL,
    `od1` DOUBLE NOT NULL,
    `od2` DOUBLE NULL,
    `ht` DOUBLE NOT NULL,
    `builtup` DOUBLE NULL,
    `weightPerPc` DOUBLE NOT NULL,
    `pcs` INTEGER NOT NULL,
    `totalWeight` DOUBLE NOT NULL,
    `coreAc` DOUBLE NULL,
    `coreMl` DOUBLE NULL,
    `d13` DOUBLE NULL,
    `turns` INTEGER NULL,
    `flux` DOUBLE NULL,
    `ateCm` DOUBLE NULL,
    `testVoltage` DOUBLE NULL,
    `testCurrent` DOUBLE NULL,
    `rateBasis` ENUM('PER_KG', 'PER_PCS') NULL,
    `rateValue` DOUBLE NULL,
    `ratePerKg` DOUBLE NULL,
    `ratePerPc` DOUBLE NULL,
    `totalAmount` DOUBLE NULL,
    `nanoPrice` DOUBLE NULL,
    `casePrice` DOUBLE NULL,
    `caseWeight` DOUBLE NULL,
    `status` ENUM('ACTIVE', 'CANCELLED') NOT NULL DEFAULT 'ACTIVE',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `PoOrderItem_poOrderId_idx`(`poOrderId`),
    INDEX `PoOrderItem_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Production` (
    `id` VARCHAR(191) NOT NULL,
    `poOrderItemId` VARCHAR(191) NOT NULL,
    `prodDate` DATETIME(3) NOT NULL,
    `pcs` INTEGER NOT NULL,
    `weightPerPc` DOUBLE NOT NULL,
    `totalWeight` DOUBLE NOT NULL,
    `labourName` VARCHAR(120) NOT NULL,
    `notes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `companyId` VARCHAR(191) NOT NULL,
    `createdById` VARCHAR(191) NULL,

    INDEX `Production_companyId_prodDate_idx`(`companyId`, `prodDate`),
    INDEX `Production_poOrderItemId_idx`(`poOrderItemId`),
    INDEX `Production_labourName_idx`(`labourName`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Dispatch` (
    `id` VARCHAR(191) NOT NULL,
    `poOrderItemId` VARCHAR(191) NOT NULL,
    `dispatchDate` DATETIME(3) NOT NULL,
    `pcs` INTEGER NOT NULL,
    `weightPerPc` DOUBLE NOT NULL,
    `totalWeight` DOUBLE NOT NULL,
    `actualWeight` DOUBLE NULL,
    `vehicleNo` VARCHAR(80) NULL,
    `notes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `companyId` VARCHAR(191) NOT NULL,
    `createdById` VARCHAR(191) NULL,

    INDEX `Dispatch_companyId_dispatchDate_idx`(`companyId`, `dispatchDate`),
    INDEX `Dispatch_poOrderItemId_idx`(`poOrderItemId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PackingList` (
    `id` VARCHAR(191) NOT NULL,
    `plNumber` VARCHAR(80) NOT NULL,
    `plDate` DATETIME(3) NOT NULL,
    `invoiceNo` VARCHAR(80) NULL,
    `invoiceDate` DATETIME(3) NULL,
    `testedBy` VARCHAR(120) NULL,
    `approvedBy` VARCHAR(120) NULL,
    `remarks` VARCHAR(200) NULL,
    `companyId` VARCHAR(191) NOT NULL,
    `createdById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `PackingList_companyId_plDate_idx`(`companyId`, `plDate`),
    UNIQUE INDEX `PackingList_companyId_plNumber_key`(`companyId`, `plNumber`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PackingListItem` (
    `id` VARCHAR(191) NOT NULL,
    `packingListId` VARCHAR(191) NOT NULL,
    `dispatchId` VARCHAR(191) NOT NULL,

    UNIQUE INDEX `PackingListItem_dispatchId_key`(`dispatchId`),
    INDEX `PackingListItem_packingListId_idx`(`packingListId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Labour` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `phone` VARCHAR(40) NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Labour_name_idx`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `LabourMembership` (
    `id` VARCHAR(191) NOT NULL,
    `labourId` VARCHAR(191) NOT NULL,
    `companyId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `LabourMembership_companyId_idx`(`companyId`),
    UNIQUE INDEX `LabourMembership_labourId_companyId_key`(`labourId`, `companyId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
-- Mirrors LabourMembership: one Supplier can be shared by many companies.
-- Tenant scoping for suppliers goes through this table (NOT Supplier.companyId,
-- which is kept for legacy backfill but no longer read by the application).
CREATE TABLE `SupplierMembership` (
    `id` VARCHAR(191) NOT NULL,
    `supplierId` VARCHAR(191) NOT NULL,
    `companyId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `SupplierMembership_companyId_idx`(`companyId`),
    UNIQUE INDEX `SupplierMembership_supplierId_companyId_key`(`supplierId`, `companyId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PushSubscription` (
    `id` VARCHAR(191) NOT NULL,
    `endpoint` VARCHAR(500) NOT NULL,
    `p256dh` VARCHAR(200) NOT NULL,
    `auth` VARCHAR(60) NOT NULL,
    `userAgent` VARCHAR(300) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `userId` VARCHAR(191) NOT NULL,
    `companyId` VARCHAR(191) NOT NULL,

    UNIQUE INDEX `PushSubscription_endpoint_key`(`endpoint`),
    INDEX `PushSubscription_companyId_idx`(`companyId`),
    INDEX `PushSubscription_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Supplier` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(160) NOT NULL,
    `email` VARCHAR(160) NULL,
    `phone` VARCHAR(40) NULL,
    `address` VARCHAR(400) NULL,
    `gstNumber` VARCHAR(40) NULL,
    `state` VARCHAR(80) NULL,
    `gstRate` DOUBLE NOT NULL DEFAULT 0,
    `notes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `companyId` VARCHAR(191) NOT NULL,
    `createdById` VARCHAR(191) NULL,

    INDEX `Supplier_companyId_createdAt_idx`(`companyId`, `createdAt`),
    INDEX `Supplier_companyId_name_idx`(`companyId`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SupplierOrder` (
    `id` VARCHAR(191) NOT NULL,
    `poNumber` VARCHAR(60) NOT NULL,
    `orderDate` DATETIME(3) NOT NULL,
    `expectedDate` DATETIME(3) NULL,
    `status` ENUM('PENDING', 'PARTIAL', 'RECEIVED', 'CANCELLED') NOT NULL DEFAULT 'PENDING',
    `notes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `companyId` VARCHAR(191) NOT NULL,
    `supplierId` VARCHAR(191) NOT NULL,
    `createdById` VARCHAR(191) NULL,

    INDEX `SupplierOrder_companyId_createdAt_idx`(`companyId`, `createdAt`),
    INDEX `SupplierOrder_supplierId_idx`(`supplierId`),
    INDEX `SupplierOrder_status_idx`(`status`),
    UNIQUE INDEX `SupplierOrder_companyId_poNumber_key`(`companyId`, `poNumber`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `WorkAllotment` (
    `id` VARCHAR(191) NOT NULL,
    `waNumber` VARCHAR(60) NOT NULL,
    `waDate` DATETIME(3) NOT NULL,
    `remarks` VARCHAR(300) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `companyId` VARCHAR(191) NOT NULL,
    `createdById` VARCHAR(191) NULL,

    INDEX `WorkAllotment_companyId_createdAt_idx`(`companyId`, `createdAt`),
    UNIQUE INDEX `WorkAllotment_companyId_waNumber_key`(`companyId`, `waNumber`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `WorkAllotmentItem` (
    `id` VARCHAR(191) NOT NULL,
    `workAllotmentId` VARCHAR(191) NOT NULL,
    `poOrderItemId` VARCHAR(191) NOT NULL,
    `pcs` INTEGER NOT NULL,
    `labourId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `WorkAllotmentItem_workAllotmentId_idx`(`workAllotmentId`),
    INDEX `WorkAllotmentItem_poOrderItemId_idx`(`poOrderItemId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SupplierOrderItem` (
    `id` VARCHAR(191) NOT NULL,
    `supplierOrderId` VARCHAR(191) NOT NULL,
    `description` VARCHAR(300) NOT NULL,
    `hsnCode` VARCHAR(20) NULL,
    `qty` DOUBLE NOT NULL,
    `unit` VARCHAR(20) NOT NULL,
    `rate` DOUBLE NOT NULL,
    `amount` DOUBLE NOT NULL,
    `notes` TEXT NULL,
    `receivedQty` DOUBLE NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `SupplierOrderItem_supplierOrderId_idx`(`supplierOrderId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ContactSubmission` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(160) NOT NULL,
    `email` VARCHAR(160) NOT NULL,
    `phone` VARCHAR(40) NULL,
    `company` VARCHAR(200) NULL,
    `subject` VARCHAR(200) NULL,
    `message` TEXT NULL,
    `formType` VARCHAR(40) NOT NULL,
    `status` ENUM('NEW', 'CONTACTED', 'ARCHIVED') NOT NULL DEFAULT 'NEW',
    `ipAddress` VARCHAR(60) NULL,
    `userAgent` VARCHAR(400) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `ContactSubmission_status_createdAt_idx`(`status`, `createdAt`),
    INDEX `ContactSubmission_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Return` (
    `id` VARCHAR(191) NOT NULL,
    `returnNumber` VARCHAR(60) NOT NULL,
    `returnDate` DATETIME(3) NOT NULL,
    `referenceType` ENUM('SO_NUMBER', 'INVOICE_NUMBER', 'WO_NUMBER') NOT NULL,
    `referenceValue` VARCHAR(80) NOT NULL,
    `status` ENUM('PENDING', 'RECEIVED', 'IN_REWORK', 'REDISPATCHED', 'CLOSED', 'CANCELLED') NOT NULL DEFAULT 'PENDING',
    `receivedAt` DATETIME(3) NULL,
    `reworkAt` DATETIME(3) NULL,
    `redispatchAt` DATETIME(3) NULL,
    `redispatchVehicle` VARCHAR(80) NULL,
    `closedAt` DATETIME(3) NULL,
    `reason` VARCHAR(400) NULL,
    `notes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `companyId` VARCHAR(191) NOT NULL,
    `customerId` VARCHAR(191) NOT NULL,
    `createdById` VARCHAR(191) NULL,

    INDEX `Return_companyId_returnDate_idx`(`companyId`, `returnDate`),
    INDEX `Return_companyId_status_idx`(`companyId`, `status`),
    INDEX `Return_customerId_idx`(`customerId`),
    UNIQUE INDEX `Return_companyId_returnNumber_key`(`companyId`, `returnNumber`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ReturnItem` (
    `id` VARCHAR(191) NOT NULL,
    `returnId` VARCHAR(191) NOT NULL,
    `poOrderItemId` VARCHAR(191) NOT NULL,
    `pcs` INTEGER NOT NULL,
    `reason` VARCHAR(300) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ReturnItem_returnId_idx`(`returnId`),
    INDEX `ReturnItem_poOrderItemId_idx`(`poOrderItemId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable — Sales Invoices (imported from the accounting export). Unique
-- per (companyId, invoiceNumber) so re-uploading the same file is idempotent.
CREATE TABLE `SalesInvoice` (
    `id` VARCHAR(191) NOT NULL,
    `companyId` VARCHAR(191) NOT NULL,
    `invoiceNumber` VARCHAR(80) NOT NULL,
    `invoiceDate` DATETIME(3) NOT NULL,
    `customerId` VARCHAR(191) NULL,
    `customerName` VARCHAR(200) NOT NULL,
    `itemDetails` VARCHAR(400) NULL,
    -- `amount` is the invoice due INCLUDING GST (the Sales Register "Total
    -- Amount"). The tax breakdown below is kept separately for reference.
    `amount` DOUBLE NOT NULL DEFAULT 0,
    `taxType` VARCHAR(40) NULL,
    `saleAmount` DOUBLE NOT NULL DEFAULT 0,
    `taxableAmount` DOUBLE NOT NULL DEFAULT 0,
    `igst` DOUBLE NOT NULL DEFAULT 0,
    `cgst` DOUBLE NOT NULL DEFAULT 0,
    `sgst` DOUBLE NOT NULL DEFAULT 0,
    `otherAmount` DOUBLE NOT NULL DEFAULT 0,
    `dueDate` DATETIME(3) NULL,
    `paidAmount` DOUBLE NOT NULL DEFAULT 0,
    `status` ENUM('UNPAID', 'PARTIAL', 'PAID') NOT NULL DEFAULT 'UNPAID',
    -- A negative invoice is a credit note (reduces the receivable).
    `docType` ENUM('INVOICE', 'CREDIT_NOTE') NOT NULL DEFAULT 'INVOICE',
    `notes` VARCHAR(400) NULL,
    `createdById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `SalesInvoice_companyId_dueDate_idx`(`companyId`, `dueDate`),
    INDEX `SalesInvoice_companyId_status_idx`(`companyId`, `status`),
    INDEX `SalesInvoice_customerId_idx`(`customerId`),
    UNIQUE INDEX `SalesInvoice_companyId_invoiceNumber_key`(`companyId`, `invoiceNumber`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable — the purchase register (supplier bills + debit notes). `amount`
-- is the payable incl. GST and net of TDS; `tds` is the register's "Other
-- Amount". A negative row is a debit note.
CREATE TABLE `PurchaseInvoice` (
    `id` VARCHAR(191) NOT NULL,
    `companyId` VARCHAR(191) NOT NULL,
    `invoiceNumber` VARCHAR(80) NOT NULL,
    `invoiceDate` DATETIME(3) NOT NULL,
    `supplierName` VARCHAR(200) NOT NULL,
    `gstin` VARCHAR(40) NULL,
    `taxType` VARCHAR(40) NULL,
    `amount` DOUBLE NOT NULL DEFAULT 0,
    `purchaseAmount` DOUBLE NOT NULL DEFAULT 0,
    `taxableAmount` DOUBLE NOT NULL DEFAULT 0,
    `igst` DOUBLE NOT NULL DEFAULT 0,
    `cgst` DOUBLE NOT NULL DEFAULT 0,
    `sgst` DOUBLE NOT NULL DEFAULT 0,
    `tds` DOUBLE NOT NULL DEFAULT 0,
    `docType` ENUM('INVOICE', 'DEBIT_NOTE') NOT NULL DEFAULT 'INVOICE',
    `notes` VARCHAR(400) NULL,
    `createdById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `PurchaseInvoice_companyId_invoiceDate_idx`(`companyId`, `invoiceDate`),
    UNIQUE INDEX `PurchaseInvoice_companyId_invoiceNumber_key`(`companyId`, `invoiceNumber`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable — a payment received from a customer; allocated FIFO across
-- that customer's open invoices via PaymentAllocation.
CREATE TABLE `Payment` (
    `id` VARCHAR(191) NOT NULL,
    `companyId` VARCHAR(191) NOT NULL,
    `customerId` VARCHAR(191) NULL,
    `customerName` VARCHAR(200) NOT NULL,
    `amount` DOUBLE NOT NULL,
    `allocatedAmount` DOUBLE NOT NULL DEFAULT 0,
    `paymentDate` DATETIME(3) NOT NULL,
    `method` VARCHAR(40) NULL,
    `reference` VARCHAR(120) NULL,
    `notes` VARCHAR(400) NULL,
    `createdById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Payment_companyId_paymentDate_idx`(`companyId`, `paymentDate`),
    INDEX `Payment_customerId_idx`(`customerId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable — how much of a Payment was applied to each SalesInvoice (FIFO).
CREATE TABLE `PaymentAllocation` (
    `id` VARCHAR(191) NOT NULL,
    `companyId` VARCHAR(191) NOT NULL,
    `paymentId` VARCHAR(191) NOT NULL,
    `salesInvoiceId` VARCHAR(191) NOT NULL,
    `amount` DOUBLE NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `PaymentAllocation_paymentId_idx`(`paymentId`),
    INDEX `PaymentAllocation_salesInvoiceId_idx`(`salesInvoiceId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Membership` ADD CONSTRAINT `Membership_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Membership` ADD CONSTRAINT `Membership_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RefreshToken` ADD CONSTRAINT `RefreshToken_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Customer` ADD CONSTRAINT `Customer_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Customer` ADD CONSTRAINT `Customer_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `FluxGrade` ADD CONSTRAINT `FluxGrade_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MaterialGrade` ADD CONSTRAINT `MaterialGrade_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PoOrder` ADD CONSTRAINT `PoOrder_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PoOrder` ADD CONSTRAINT `PoOrder_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `Customer`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PoOrder` ADD CONSTRAINT `PoOrder_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PoOrderItem` ADD CONSTRAINT `PoOrderItem_poOrderId_fkey` FOREIGN KEY (`poOrderId`) REFERENCES `PoOrder`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Production` ADD CONSTRAINT `Production_poOrderItemId_fkey` FOREIGN KEY (`poOrderItemId`) REFERENCES `PoOrderItem`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Production` ADD CONSTRAINT `Production_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Production` ADD CONSTRAINT `Production_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Dispatch` ADD CONSTRAINT `Dispatch_poOrderItemId_fkey` FOREIGN KEY (`poOrderItemId`) REFERENCES `PoOrderItem`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Dispatch` ADD CONSTRAINT `Dispatch_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Dispatch` ADD CONSTRAINT `Dispatch_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PackingList` ADD CONSTRAINT `PackingList_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PackingList` ADD CONSTRAINT `PackingList_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PackingListItem` ADD CONSTRAINT `PackingListItem_packingListId_fkey` FOREIGN KEY (`packingListId`) REFERENCES `PackingList`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PackingListItem` ADD CONSTRAINT `PackingListItem_dispatchId_fkey` FOREIGN KEY (`dispatchId`) REFERENCES `Dispatch`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LabourMembership` ADD CONSTRAINT `LabourMembership_labourId_fkey` FOREIGN KEY (`labourId`) REFERENCES `Labour`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LabourMembership` ADD CONSTRAINT `LabourMembership_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PushSubscription` ADD CONSTRAINT `PushSubscription_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PushSubscription` ADD CONSTRAINT `PushSubscription_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Supplier` ADD CONSTRAINT `Supplier_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Supplier` ADD CONSTRAINT `Supplier_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SupplierOrder` ADD CONSTRAINT `SupplierOrder_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SupplierOrder` ADD CONSTRAINT `SupplierOrder_supplierId_fkey` FOREIGN KEY (`supplierId`) REFERENCES `Supplier`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SupplierOrder` ADD CONSTRAINT `SupplierOrder_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `WorkAllotment` ADD CONSTRAINT `WorkAllotment_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `WorkAllotment` ADD CONSTRAINT `WorkAllotment_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `WorkAllotmentItem` ADD CONSTRAINT `WorkAllotmentItem_workAllotmentId_fkey` FOREIGN KEY (`workAllotmentId`) REFERENCES `WorkAllotment`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `WorkAllotmentItem` ADD CONSTRAINT `WorkAllotmentItem_poOrderItemId_fkey` FOREIGN KEY (`poOrderItemId`) REFERENCES `PoOrderItem`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `WorkAllotmentItem` ADD CONSTRAINT `WorkAllotmentItem_labourId_fkey` FOREIGN KEY (`labourId`) REFERENCES `Labour`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SupplierOrderItem` ADD CONSTRAINT `SupplierOrderItem_supplierOrderId_fkey` FOREIGN KEY (`supplierOrderId`) REFERENCES `SupplierOrder`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Return` ADD CONSTRAINT `Return_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Return` ADD CONSTRAINT `Return_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `Customer`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Return` ADD CONSTRAINT `Return_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ReturnItem` ADD CONSTRAINT `ReturnItem_returnId_fkey` FOREIGN KEY (`returnId`) REFERENCES `Return`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ReturnItem` ADD CONSTRAINT `ReturnItem_poOrderItemId_fkey` FOREIGN KEY (`poOrderItemId`) REFERENCES `PoOrderItem`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- =====================================================================
-- MIGRATION FOR EXISTING DATABASES — Supplier multi-company
-- =====================================================================
-- If you already have data and want to enable sharing a supplier across
-- companies, run these once in phpMyAdmin (in order):
--
--   CREATE TABLE `SupplierMembership` (
--       `id` VARCHAR(191) NOT NULL,
--       `supplierId` VARCHAR(191) NOT NULL,
--       `companyId` VARCHAR(191) NOT NULL,
--       `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
--       INDEX `SupplierMembership_companyId_idx`(`companyId`),
--       UNIQUE INDEX `SupplierMembership_supplierId_companyId_key`(`supplierId`, `companyId`),
--       PRIMARY KEY (`id`)
--   ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
--
--   -- Backfill — every existing supplier becomes a member of its current company.
--   INSERT INTO `SupplierMembership` (`id`, `supplierId`, `companyId`)
--   SELECT UUID(), `id`, `companyId` FROM `Supplier`;
--
-- That's it. `Supplier.companyId` is no longer read by the app but is
-- left in place for safety; you can drop it later once you've confirmed
-- everything works.
-- =====================================================================

-- =====================================================================
-- FIRST-RUN ADMIN
-- =====================================================================
-- The password column stores a bcrypt hash, not the plain password, so
-- we can't include a working INSERT for it here. After importing this
-- file, run ONCE from the project root to create the platform admin:
--
--     npm --workspace server run seed
--
-- That creates:
--     email:    admin@metflux.com     (or SEED_SUPERADMIN_EMAIL)
--     username: admin                 (or SEED_SUPERADMIN_USERNAME)
--     password: ChangeMe!123          (or SEED_SUPERADMIN_PASSWORD)
--     company:  Metflux Demo Co       (or SEED_DEFAULT_COMPANY_NAME)
--
-- Change the password immediately after first login.
-- =====================================================================


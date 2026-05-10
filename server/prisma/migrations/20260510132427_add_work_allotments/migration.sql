-- AlterTable
ALTER TABLE `company` ADD COLUMN `whatsappNumber` VARCHAR(40) NULL;

-- AlterTable
ALTER TABLE `poorderitem` ADD COLUMN `ateCm` DOUBLE NULL,
    ADD COLUMN `flux` DOUBLE NULL,
    ADD COLUMN `status` ENUM('ACTIVE', 'CANCELLED') NOT NULL DEFAULT 'ACTIVE',
    ADD COLUMN `testCurrent` DOUBLE NULL,
    ADD COLUMN `testVoltage` DOUBLE NULL,
    ADD COLUMN `turns` INTEGER NULL;

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
    `receivedQty` DOUBLE NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `SupplierOrderItem_supplierOrderId_idx`(`supplierOrderId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `PoOrderItem_status_idx` ON `PoOrderItem`(`status`);

-- AddForeignKey
ALTER TABLE `FluxGrade` ADD CONSTRAINT `FluxGrade_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

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

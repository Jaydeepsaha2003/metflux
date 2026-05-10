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

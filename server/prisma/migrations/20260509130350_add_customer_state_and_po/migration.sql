-- AlterTable
ALTER TABLE `customer` ADD COLUMN `state` VARCHAR(80) NULL;

-- CreateTable
CREATE TABLE `MaterialGrade` (
    `id` VARCHAR(191) NOT NULL,
    `grade` VARCHAR(80) NOT NULL,
    `material` VARCHAR(120) NOT NULL,
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
    `coreType` ENUM('TOROIDAL', 'RECTANGULAR') NOT NULL,
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
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `PoOrderItem_poOrderId_idx`(`poOrderId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

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

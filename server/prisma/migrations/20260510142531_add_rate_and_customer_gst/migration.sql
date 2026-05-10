-- AlterTable
ALTER TABLE `customer` ADD COLUMN `gstRate` DOUBLE NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE `poorderitem` ADD COLUMN `rateBasis` ENUM('PER_KG', 'PER_PCS') NULL,
    ADD COLUMN `ratePerKg` DOUBLE NULL,
    ADD COLUMN `ratePerPc` DOUBLE NULL,
    ADD COLUMN `rateValue` DOUBLE NULL,
    ADD COLUMN `totalAmount` DOUBLE NULL;

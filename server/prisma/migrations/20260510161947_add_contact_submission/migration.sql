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

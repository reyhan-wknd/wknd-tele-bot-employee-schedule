-- CreateTable
CREATE TABLE `holidays` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `year` INTEGER NOT NULL,
    `month` INTEGER NOT NULL,
    `day` INTEGER NOT NULL,
    `label` VARCHAR(255) NOT NULL,

    INDEX `holidays_month_day_idx`(`month`, `day`),
    UNIQUE INDEX `holidays_year_month_day_key`(`year`, `month`, `day`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

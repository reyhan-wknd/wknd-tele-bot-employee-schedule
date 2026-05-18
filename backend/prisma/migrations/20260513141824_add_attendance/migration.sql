-- CreateTable
CREATE TABLE `attendances` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `telegram_id` BIGINT NOT NULL,
    `date` DATE NOT NULL,
    `check_in` DATETIME(3) NOT NULL,
    `check_out` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `attendances_telegram_id_date_key`(`telegram_id`, `date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `attendances` ADD CONSTRAINT `attendances_telegram_id_fkey` FOREIGN KEY (`telegram_id`) REFERENCES `users`(`telegram_id`) ON DELETE RESTRICT ON UPDATE CASCADE;

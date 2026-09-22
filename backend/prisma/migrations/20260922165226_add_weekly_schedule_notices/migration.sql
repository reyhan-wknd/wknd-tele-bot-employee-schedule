-- CreateTable
CREATE TABLE `weekly_schedule_notices` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `telegram_id` BIGINT NOT NULL,
    `week_start` DATE NOT NULL,
    `status` VARCHAR(20) NOT NULL,
    `snapshot` TEXT NOT NULL,
    `notified_on` DATE NOT NULL,
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `weekly_schedule_notices_telegram_id_week_start_key`(`telegram_id`, `week_start`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

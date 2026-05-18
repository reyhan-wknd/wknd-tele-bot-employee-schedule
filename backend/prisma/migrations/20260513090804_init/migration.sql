-- CreateTable
CREATE TABLE `users` (
    `telegram_id` BIGINT NOT NULL,
    `google_email` VARCHAR(255) NOT NULL,
    `google_sub` VARCHAR(255) NOT NULL,
    `access_token` TEXT NULL,
    `refresh_token` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `users_google_email_key`(`google_email`),
    UNIQUE INDEX `users_google_sub_key`(`google_sub`),
    PRIMARY KEY (`telegram_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

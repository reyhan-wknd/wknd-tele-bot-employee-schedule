-- CreateTable
CREATE TABLE `scheduled_jobs` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `type` VARCHAR(50) NOT NULL,
    `telegram_id` BIGINT NOT NULL,
    `attendance_id` INTEGER NOT NULL,
    `run_at` DATETIME(3) NOT NULL,
    `status` VARCHAR(20) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `scheduled_jobs_status_run_at_idx`(`status`, `run_at`),
    INDEX `scheduled_jobs_attendance_id_idx`(`attendance_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

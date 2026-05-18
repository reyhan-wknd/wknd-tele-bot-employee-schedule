-- CreateTable
CREATE TABLE `schedules` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `employee_nik` VARCHAR(50) NOT NULL,
    `job_title` VARCHAR(255) NOT NULL,
    `name` VARCHAR(255) NOT NULL,
    `status` VARCHAR(50) NOT NULL,
    `project_name` VARCHAR(255) NOT NULL,
    `date` DATE NOT NULL,

    INDEX `schedules_employee_nik_idx`(`employee_nik`),
    INDEX `schedules_date_idx`(`date`),
    INDEX `schedules_name_idx`(`name`),
    INDEX `schedules_employee_nik_date_idx`(`employee_nik`, `date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `user_schedules` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `telegram_id` BIGINT NOT NULL,
    `employee_nik` VARCHAR(50) NOT NULL,

    UNIQUE INDEX `user_schedules_telegram_id_key`(`telegram_id`),
    INDEX `user_schedules_employee_nik_idx`(`employee_nik`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `user_schedules` ADD CONSTRAINT `user_schedules_telegram_id_fkey` FOREIGN KEY (`telegram_id`) REFERENCES `users`(`telegram_id`) ON DELETE RESTRICT ON UPDATE CASCADE;

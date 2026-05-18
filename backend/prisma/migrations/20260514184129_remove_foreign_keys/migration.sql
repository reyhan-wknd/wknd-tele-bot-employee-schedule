-- DropForeignKey
ALTER TABLE `attendances` DROP FOREIGN KEY `attendances_telegram_id_fkey`;

-- DropForeignKey
ALTER TABLE `user_schedules` DROP FOREIGN KEY `user_schedules_telegram_id_fkey`;

-- CreateIndex
CREATE INDEX `attendances_telegram_id_idx` ON `attendances`(`telegram_id`);

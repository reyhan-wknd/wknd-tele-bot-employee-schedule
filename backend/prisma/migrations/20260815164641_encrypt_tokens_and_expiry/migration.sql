-- AlterTable
ALTER TABLE `schedules` DROP COLUMN `status`;

-- AlterTable
ALTER TABLE `users` ADD COLUMN `token_expiry` DATETIME(3) NULL;


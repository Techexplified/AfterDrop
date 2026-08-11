-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "sentEmails" JSONB NOT NULL DEFAULT '{}';

-- AlterTable
ALTER TABLE "TemplateSettings" ADD COLUMN     "customConfigs" JSONB NOT NULL DEFAULT '{}';

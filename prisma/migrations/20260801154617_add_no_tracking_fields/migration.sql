-- AlterTable
ALTER TABLE "ShopSettings" ADD COLUMN     "noTrackDays" INTEGER NOT NULL DEFAULT 7,
ADD COLUMN     "noTracking" TEXT NOT NULL DEFAULT 'fixed';

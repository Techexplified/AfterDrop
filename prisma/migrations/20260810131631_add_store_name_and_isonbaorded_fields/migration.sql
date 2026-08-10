-- AlterTable
ALTER TABLE "ShopSettings" ADD COLUMN     "isOnboarded" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "storeName" TEXT;

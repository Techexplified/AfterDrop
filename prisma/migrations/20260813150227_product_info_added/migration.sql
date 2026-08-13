-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "primaryProductId" TEXT,
ADD COLUMN     "primaryProductName" TEXT;

-- AlterTable
ALTER TABLE "Review" ADD COLUMN     "productId" TEXT,
ADD COLUMN     "productName" TEXT;

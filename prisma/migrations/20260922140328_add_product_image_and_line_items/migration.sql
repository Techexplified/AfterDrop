-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "lineItems" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "primaryProductImage" TEXT;

-- AlterTable
ALTER TABLE "Review" ADD COLUMN     "productImage" TEXT;

/*
  Warnings:

  - A unique constraint covering the columns `[reviewToken]` on the table `Order` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "reviewToken" TEXT;

-- CreateTable
CREATE TABLE "Review" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "displayName" TEXT,
    "rating" INTEGER NOT NULL,
    "body" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Review_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Review_shop_idx" ON "Review"("shop");

-- CreateIndex
CREATE INDEX "Review_orderId_idx" ON "Review"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "Order_reviewToken_key" ON "Order"("reviewToken");

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

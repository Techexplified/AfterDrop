-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "customerTags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "productTypes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "totalPrice" INTEGER NOT NULL DEFAULT 0,
    "fulfilledAt" TIMESTAMP(3),
    "trackingNumber" TEXT,
    "deliveredAt" TIMESTAMP(3),
    "estimatedDeliveryAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "refundedAt" TIMESTAMP(3),
    "deliveryFailed" BOOLEAN NOT NULL DEFAULT false,
    "unsubscribed" BOOLEAN NOT NULL DEFAULT false,
    "sentAt" TIMESTAMP(3),
    "skippedByYou" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Order_shop_idx" ON "Order"("shop");

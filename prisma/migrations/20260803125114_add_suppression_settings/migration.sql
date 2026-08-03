-- CreateTable
CREATE TABLE "SuppressionSettings" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "refundedCancelled" BOOLEAN NOT NULL DEFAULT true,
    "deliveryFailed" BOOLEAN NOT NULL DEFAULT true,
    "openSupportTicket" BOOLEAN NOT NULL DEFAULT false,
    "unsubscribed" BOOLEAN NOT NULL DEFAULT true,
    "alreadyReviewed" BOOLEAN NOT NULL DEFAULT false,
    "cooldownEnabled" BOOLEAN NOT NULL DEFAULT true,
    "cooldownDays" INTEGER NOT NULL DEFAULT 10,
    "excludedTags" TEXT[] DEFAULT ARRAY['wholesale']::TEXT[],
    "excludedProductTypes" TEXT[] DEFAULT ARRAY['Digital']::TEXT[],
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SuppressionSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SuppressionSettings_shop_key" ON "SuppressionSettings"("shop");

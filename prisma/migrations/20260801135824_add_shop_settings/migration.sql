-- CreateTable
CREATE TABLE "ShopSettings" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "settleInDays" INTEGER NOT NULL DEFAULT 3,
    "sendHour" INTEGER NOT NULL DEFAULT 10,
    "clockSource" TEXT NOT NULL DEFAULT 'customer',
    "quietDays" INTEGER[] DEFAULT ARRAY[0]::INTEGER[],
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShopSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ShopSettings_shop_key" ON "ShopSettings"("shop");

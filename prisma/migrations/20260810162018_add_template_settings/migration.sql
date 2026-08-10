-- CreateTable
CREATE TABLE "TemplateSettings" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "enabledTemplates" TEXT[] DEFAULT ARRAY['review']::TEXT[],
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TemplateSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TemplateSettings_shop_key" ON "TemplateSettings"("shop");

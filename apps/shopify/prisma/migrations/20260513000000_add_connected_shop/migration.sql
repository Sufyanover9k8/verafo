-- CreateTable
CREATE TABLE "ConnectedShop" (
    "shop" TEXT NOT NULL PRIMARY KEY,
    "storeId" TEXT NOT NULL,
    "shopName" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

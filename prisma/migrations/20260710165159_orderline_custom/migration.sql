-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_OrderLine" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "eventId" TEXT NOT NULL,
    "productId" TEXT,
    "customName" TEXT,
    "customUnit" TEXT,
    "qty" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,
    CONSTRAINT "OrderLine_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "OrderLine_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_OrderLine" ("eventId", "id", "note", "productId", "qty") SELECT "eventId", "id", "note", "productId", "qty" FROM "OrderLine";
DROP TABLE "OrderLine";
ALTER TABLE "new_OrderLine" RENAME TO "OrderLine";
CREATE UNIQUE INDEX "OrderLine_eventId_productId_key" ON "OrderLine"("eventId", "productId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- AlterTable
ALTER TABLE "Product" ADD COLUMN "description" TEXT;

-- CreateTable
CREATE TABLE "OrderChange" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "eventId" TEXT NOT NULL,
    "actorId" TEXT,
    "actorName" TEXT NOT NULL,
    "itemName" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "before" TEXT,
    "after" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OrderChange_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Notification" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "recipientId" TEXT NOT NULL,
    "actorName" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "eventId" TEXT,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sinceAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "changeCount" INTEGER NOT NULL DEFAULT 1,
    "pushedAt" DATETIME,
    CONSTRAINT "Notification_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Notification" ("actorName", "createdAt", "eventId", "id", "message", "read", "recipientId", "type") SELECT "actorName", "createdAt", "eventId", "id", "message", "read", "recipientId", "type" FROM "Notification";
DROP TABLE "Notification";
ALTER TABLE "new_Notification" RENAME TO "Notification";
CREATE INDEX "Notification_recipientId_read_idx" ON "Notification"("recipientId", "read");
CREATE INDEX "Notification_recipientId_createdAt_idx" ON "Notification"("recipientId", "createdAt");
CREATE INDEX "Notification_type_pushedAt_idx" ON "Notification"("type", "pushedAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "OrderChange_eventId_createdAt_idx" ON "OrderChange"("eventId", "createdAt");

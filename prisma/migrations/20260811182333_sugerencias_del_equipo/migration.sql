-- AlterTable
ALTER TABLE "Notification" ADD COLUMN "linkUrl" TEXT;

-- CreateTable
CREATE TABLE "Suggestion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "authorId" TEXT NOT NULL,
    "authorName" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'NUEVA',
    "screen" TEXT,
    "eventId" TEXT,
    "eventLugar" TEXT,
    "productId" TEXT,
    "contextNote" TEXT,
    "appVersion" TEXT,
    "device" TEXT,
    "reply" TEXT,
    "repliedAt" DATETIME,
    "repliedByName" TEXT,
    "statusAt" DATETIME,
    "clientKey" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Suggestion_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Suggestion_clientKey_key" ON "Suggestion"("clientKey");

-- CreateIndex
CREATE INDEX "Suggestion_authorId_createdAt_idx" ON "Suggestion"("authorId", "createdAt");

-- CreateIndex
CREATE INDEX "Suggestion_status_createdAt_idx" ON "Suggestion"("status", "createdAt");

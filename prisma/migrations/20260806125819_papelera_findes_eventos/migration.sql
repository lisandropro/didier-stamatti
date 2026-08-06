-- AlterTable
ALTER TABLE "Event" ADD COLUMN "deletedAt" DATETIME;

-- AlterTable
ALTER TABLE "Weekend" ADD COLUMN "deletedAt" DATETIME;

-- CreateIndex
CREATE INDEX "Event_weekendId_deletedAt_idx" ON "Event"("weekendId", "deletedAt");

-- CreateIndex
CREATE INDEX "Weekend_deletedAt_idx" ON "Weekend"("deletedAt");

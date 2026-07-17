-- CreateTable
CREATE TABLE "WeekendSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "weekendId" TEXT NOT NULL,
    "takenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "data" TEXT NOT NULL,
    CONSTRAINT "WeekendSnapshot_weekendId_fkey" FOREIGN KEY ("weekendId") REFERENCES "Weekend" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "WeekendSnapshot_weekendId_key" ON "WeekendSnapshot"("weekendId");

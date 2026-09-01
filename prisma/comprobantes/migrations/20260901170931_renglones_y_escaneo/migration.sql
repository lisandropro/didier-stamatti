-- CreateTable
CREATE TABLE "DocumentLine" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "documentId" TEXT NOT NULL,
    "orden" INTEGER NOT NULL,
    "codigo" TEXT,
    "descripcion" TEXT NOT NULL,
    "cantidad" BIGINT,
    "unidad" TEXT,
    "precioUnitario" BIGINT,
    "subtotal" BIGINT,
    CONSTRAINT "DocumentLine_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Attachment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "variante" TEXT NOT NULL DEFAULT 'ORIGINAL',
    "documentId" TEXT NOT NULL,
    "s3Key" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "page" INTEGER NOT NULL DEFAULT 1,
    "uploadedById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Attachment_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Attachment" ("createdAt", "documentId", "id", "mimeType", "page", "s3Key", "sizeBytes", "uploadedById") SELECT "createdAt", "documentId", "id", "mimeType", "page", "s3Key", "sizeBytes", "uploadedById" FROM "Attachment";
DROP TABLE "Attachment";
ALTER TABLE "new_Attachment" RENAME TO "Attachment";
CREATE UNIQUE INDEX "Attachment_s3Key_key" ON "Attachment"("s3Key");
CREATE INDEX "Attachment_documentId_page_idx" ON "Attachment"("documentId", "page");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "DocumentLine_documentId_orden_idx" ON "DocumentLine"("documentId", "orden");

-- CreateIndex
CREATE INDEX "DocumentLine_descripcion_idx" ON "DocumentLine"("descripcion");

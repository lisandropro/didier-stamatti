-- AlterTable
ALTER TABLE "Document" ADD COLUMN "iva" BIGINT;
ALTER TABLE "Document" ADD COLUMN "moneda" TEXT DEFAULT 'PES';
ALTER TABLE "Document" ADD COLUMN "neto" BIGINT;
ALTER TABLE "Document" ADD COLUMN "pagoLoteId" TEXT;
ALTER TABLE "Document" ADD COLUMN "percepciones" BIGINT;

-- CreateTable
CREATE TABLE "CapturaVista" (
    "clientKey" TEXT NOT NULL PRIMARY KEY,
    "documentId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CapturaVista_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "CapturaVista_documentId_idx" ON "CapturaVista"("documentId");

-- CreateIndex
CREATE INDEX "Document_pagoLoteId_idx" ON "Document"("pagoLoteId");

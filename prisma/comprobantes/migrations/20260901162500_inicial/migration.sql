-- CreateTable
CREATE TABLE "Supplier" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "cuit" TEXT,
    "alias" TEXT,
    "diasPago" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" DATETIME
);

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "kind" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "cuitEmisor" TEXT,
    "tipoCbte" TEXT,
    "puntoVenta" INTEGER,
    "numero" INTEGER,
    "fechaEmision" TEXT,
    "importeTotal" BIGINT,
    "cae" TEXT,
    "caeVence" TEXT,
    "supplierId" TEXT,
    "destino" TEXT,
    "destinoNota" TEXT,
    "conforme" BOOLEAN,
    "faltantesNota" TEXT,
    "vencimiento" TEXT,
    "pagadoAt" DATETIME,
    "enArca" BOOLEAN,
    "capturedById" TEXT,
    "capturedByName" TEXT,
    "clientKey" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" DATETIME,
    "mergedIntoId" TEXT,
    CONSTRAINT "Document_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Attachment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "documentId" TEXT NOT NULL,
    "s3Key" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "page" INTEGER NOT NULL DEFAULT 1,
    "uploadedById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Attachment_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DocumentChange" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "documentId" TEXT NOT NULL,
    "actorId" TEXT,
    "actorName" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "before" TEXT,
    "after" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DocumentChange_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Supplier_cuit_key" ON "Supplier"("cuit");

-- CreateIndex
CREATE UNIQUE INDEX "Document_clientKey_key" ON "Document"("clientKey");

-- CreateIndex
CREATE INDEX "Document_supplierId_pagadoAt_idx" ON "Document"("supplierId", "pagadoAt");

-- CreateIndex
CREATE INDEX "Document_vencimiento_pagadoAt_idx" ON "Document"("vencimiento", "pagadoAt");

-- CreateIndex
CREATE INDEX "Document_deletedAt_idx" ON "Document"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Document_cuitEmisor_tipoCbte_puntoVenta_numero_key" ON "Document"("cuitEmisor", "tipoCbte", "puntoVenta", "numero");

-- CreateIndex
CREATE UNIQUE INDEX "Attachment_s3Key_key" ON "Attachment"("s3Key");

-- CreateIndex
CREATE INDEX "Attachment_documentId_page_idx" ON "Attachment"("documentId", "page");

-- CreateIndex
CREATE INDEX "DocumentChange_documentId_createdAt_idx" ON "DocumentChange"("documentId", "createdAt");

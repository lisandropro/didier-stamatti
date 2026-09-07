-- CreateTable
CREATE TABLE "Entidad" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "nombre" TEXT NOT NULL,
    "cuit" TEXT NOT NULL,
    "activa" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" DATETIME
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Document" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "kind" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "cuitEmisor" TEXT,
    "tipoCbte" TEXT,
    "puntoVenta" INTEGER,
    "numero" INTEGER,
    "fechaEmision" TEXT,
    "importeTotal" BIGINT,
    "neto" BIGINT,
    "iva" BIGINT,
    "percepciones" BIGINT,
    "moneda" TEXT DEFAULT 'PES',
    "cae" TEXT,
    "caeVence" TEXT,
    "supplierId" TEXT,
    "entidadId" TEXT,
    "destino" TEXT,
    "destinoNota" TEXT,
    "conforme" BOOLEAN,
    "faltantesNota" TEXT,
    "vencimiento" TEXT,
    "pagadoAt" DATETIME,
    "pagoLoteId" TEXT,
    "enArca" BOOLEAN,
    "capturedById" TEXT,
    "capturedByName" TEXT,
    "clientKey" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" DATETIME,
    "mergedIntoId" TEXT,
    CONSTRAINT "Document_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Document_entidadId_fkey" FOREIGN KEY ("entidadId") REFERENCES "Entidad" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Document" ("cae", "caeVence", "capturedById", "capturedByName", "clientKey", "conforme", "createdAt", "cuitEmisor", "deletedAt", "destino", "destinoNota", "enArca", "faltantesNota", "fechaEmision", "id", "importeTotal", "iva", "kind", "mergedIntoId", "moneda", "neto", "numero", "pagadoAt", "pagoLoteId", "percepciones", "puntoVenta", "source", "supplierId", "tipoCbte", "vencimiento") SELECT "cae", "caeVence", "capturedById", "capturedByName", "clientKey", "conforme", "createdAt", "cuitEmisor", "deletedAt", "destino", "destinoNota", "enArca", "faltantesNota", "fechaEmision", "id", "importeTotal", "iva", "kind", "mergedIntoId", "moneda", "neto", "numero", "pagadoAt", "pagoLoteId", "percepciones", "puntoVenta", "source", "supplierId", "tipoCbte", "vencimiento" FROM "Document";
DROP TABLE "Document";
ALTER TABLE "new_Document" RENAME TO "Document";
CREATE UNIQUE INDEX "Document_clientKey_key" ON "Document"("clientKey");
CREATE INDEX "Document_entidadId_pagadoAt_idx" ON "Document"("entidadId", "pagadoAt");
CREATE INDEX "Document_supplierId_pagadoAt_idx" ON "Document"("supplierId", "pagadoAt");
CREATE INDEX "Document_pagoLoteId_idx" ON "Document"("pagoLoteId");
CREATE INDEX "Document_vencimiento_pagadoAt_idx" ON "Document"("vencimiento", "pagadoAt");
CREATE INDEX "Document_deletedAt_idx" ON "Document"("deletedAt");
CREATE UNIQUE INDEX "Document_cuitEmisor_tipoCbte_puntoVenta_numero_key" ON "Document"("cuitEmisor", "tipoCbte", "puntoVenta", "numero");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "Entidad_cuit_key" ON "Entidad"("cuit");

-- ---------------------------------------------------------------------------
-- La entidad que hasta hoy estaba escrita en el codigo
-- ---------------------------------------------------------------------------
--
-- `CUIT_PROPIO` vivia en lib/comprobantes/qr.ts. Todo comprobante que hay en
-- esta tabla se capturo mientras esa constante era la unica empresa que el
-- sistema conocia, asi que todos son de ella. Por eso el backfill es correcto y
-- no una suposicion: no habia forma de cargar una factura de otra entidad.
--
-- El nombre es editable desde la pantalla de entidades. Se pone uno razonable
-- en vez de dejarlo vacio, pero el dato que identifica es el CUIT.
INSERT INTO "Entidad" ("id", "nombre", "cuit", "activa", "createdAt")
VALUES ('ent-soluciones-eventos', 'Soluciones para Eventos S.A.', '30717737489', 1, CURRENT_TIMESTAMP);

UPDATE "Document" SET "entidadId" = 'ent-soluciones-eventos' WHERE "entidadId" IS NULL;

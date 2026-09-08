-- CreateTable
CREATE TABLE "ArcaImport" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "entidadId" TEXT NOT NULL,
    "archivo" TEXT NOT NULL,
    "hashArchivo" TEXT NOT NULL,
    "filasLeidas" INTEGER NOT NULL,
    "completadas" INTEGER NOT NULL,
    "creadas" INTEGER NOT NULL,
    "sinRespaldo" INTEGER NOT NULL,
    "discrepancias" INTEGER NOT NULL,
    "desde" TEXT,
    "hasta" TEXT,
    "actorId" TEXT,
    "actorName" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "ArcaImport_entidadId_createdAt_idx" ON "ArcaImport"("entidadId", "createdAt");

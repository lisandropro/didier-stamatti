-- CreateTable
CREATE TABLE "EventoIngreso" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "eventoId" TEXT NOT NULL,
    "lugar" TEXT NOT NULL,
    "fecha" TEXT NOT NULL,
    "entidadId" TEXT,
    "precioPorPersona" BIGINT,
    "comensales" INTEGER,
    "conIva" BOOLEAN,
    "cargadoPorId" TEXT,
    "cargadoPorName" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "EventoIngreso_entidadId_fkey" FOREIGN KEY ("entidadId") REFERENCES "Entidad" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "EventoExtra" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ingresoId" TEXT NOT NULL,
    "descripcion" TEXT NOT NULL,
    "importe" BIGINT NOT NULL,
    "orden" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "EventoExtra_ingresoId_fkey" FOREIGN KEY ("ingresoId") REFERENCES "EventoIngreso" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "EventoIngreso_eventoId_key" ON "EventoIngreso"("eventoId");

-- CreateIndex
CREATE INDEX "EventoIngreso_fecha_idx" ON "EventoIngreso"("fecha");

-- CreateIndex
CREATE INDEX "EventoExtra_ingresoId_orden_idx" ON "EventoExtra"("ingresoId", "orden");

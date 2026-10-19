-- Preparación en el depósito: lo que se tildó, ítem por ítem, y la marca de
-- cambio tardío en el historial del pedido.
--
-- Todo es nuevo o tiene valor por omisión: ningún dato existente cambia. Los
-- cambios ya guardados quedan con tardio = false, que es lo cierto: hasta hoy
-- nadie tildaba nada.
--
-- SQLite no agrega una columna con indice nuevo en el lugar: Prisma rehace la
-- tabla OrderChange (crea la nueva, copia las nueve columnas, borra la vieja y
-- recrea los indices). Los cambios ya registrados pasan enteros.

-- CreateTable
CREATE TABLE "Preparacion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "eventId" TEXT NOT NULL,
    "clave" TEXT NOT NULL,
    "itemName" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "note" TEXT,
    "porId" TEXT,
    "porName" TEXT NOT NULL,
    "at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Preparacion_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_OrderChange" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "eventId" TEXT NOT NULL,
    "actorId" TEXT,
    "actorName" TEXT NOT NULL,
    "itemName" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "before" TEXT,
    "after" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tardio" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "OrderChange_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_OrderChange" ("actorId", "actorName", "after", "before", "createdAt", "eventId", "id", "itemName", "kind") SELECT "actorId", "actorName", "after", "before", "createdAt", "eventId", "id", "itemName", "kind" FROM "OrderChange";
DROP TABLE "OrderChange";
ALTER TABLE "new_OrderChange" RENAME TO "OrderChange";
CREATE INDEX "OrderChange_eventId_createdAt_idx" ON "OrderChange"("eventId", "createdAt");
CREATE INDEX "OrderChange_tardio_createdAt_idx" ON "OrderChange"("tardio", "createdAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "Preparacion_eventId_clave_key" ON "Preparacion"("eventId", "clave");


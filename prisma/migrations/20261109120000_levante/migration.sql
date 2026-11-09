-- Levante: lo que se revisó al juntar todo después de un evento, ítem por
-- ítem, y en el evento cuándo y quién terminó el levante.
--
-- Todo es nuevo o nulo: ningún dato existente cambia. Los eventos ya hechos
-- quedan con el levante sin terminar (levanteAt nulo), que es lo cierto: hasta
-- hoy nadie lo marcaba. Los de la última semana aparecen en "Para levantar";
-- los más viejos no, por la ventana de 7 días.

-- AlterTable
ALTER TABLE "Event" ADD COLUMN "levanteAt" DATETIME;
ALTER TABLE "Event" ADD COLUMN "levantePorId" TEXT;
ALTER TABLE "Event" ADD COLUMN "levantePorName" TEXT;

-- CreateTable
CREATE TABLE "Levante" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "eventId" TEXT NOT NULL,
    "clave" TEXT NOT NULL,
    "itemName" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "faltan" INTEGER NOT NULL DEFAULT 0,
    "porId" TEXT,
    "porName" TEXT NOT NULL,
    "at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "descontadoMotivo" TEXT,
    "descontadoAt" DATETIME,
    "descontadoPorId" TEXT,
    "descontadoPorName" TEXT,
    CONSTRAINT "Levante_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Levante_eventId_clave_key" ON "Levante"("eventId", "clave");

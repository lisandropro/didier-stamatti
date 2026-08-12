-- Fin de semana -> Período operativo.
--
-- Escrita a mano: la que genera Prisma borra la tabla Weekend y con ella los
-- períodos, los eventos y los 276 renglones de pedido. Acá **se conserva todo**,
-- empezando por los identificadores, que es lo que mantiene vivos los vínculos.
--
-- Además de renombrar, convierte dos cosas:
--
-- 1. Los límites del período pasan de instante a **día de calendario** (texto
--    AAAA-MM-DD). Estaban guardados como medianoche UTC, así que el día es
--    literalmente los primeros 10 caracteres. Sin hora, ninguna zona horaria
--    puede volver a correrlos un día.
-- 2. Las fechas de los eventos se corren +3 horas. Estaban escritas como si la
--    hora de pared fuera UTC (el servidor corre en UTC); de ahora en más se leen
--    en hora argentina, y sin este ajuste un evento de las 21 pasaría a verse a
--    las 18. Argentina es UTC-3 fijo desde 2009, así que +3 vale para todas.
--
-- El nombre pasa a ser opcional: los que eran iguales al rango ("15 al 16 ago")
-- se vacían para que sigan a las fechas cuando se editen. Guardar un nombre
-- derivado de las fechas es justamente lo que queda desactualizado.

PRAGMA foreign_keys=OFF;

-- 1. El período operativo, con los mismos identificadores que el finde.
CREATE TABLE "OperationalPeriod" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "label" TEXT,
    "startDay" TEXT NOT NULL,
    "endDay" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" DATETIME
);

INSERT INTO "OperationalPeriod" ("id", "label", "startDay", "endDay", "createdAt", "deletedAt")
SELECT
    "id",
    CASE
      -- Tres formas posibles, las mismas que arma fmtRangoDias: mismo mes,
      -- mismo año con meses distintos, y años distintos (Año Nuevo).
      WHEN "label" IN (
        -- a) mismo mes: "15 al 16 ago"
        CAST(substr("startDate", 9, 2) AS INTEGER) || ' al ' ||
        CAST(substr("endDate", 9, 2) AS INTEGER) || ' ' ||
        (CASE substr("endDate", 6, 2)
           WHEN '01' THEN 'ene' WHEN '02' THEN 'feb' WHEN '03' THEN 'mar'
           WHEN '04' THEN 'abr' WHEN '05' THEN 'may' WHEN '06' THEN 'jun'
           WHEN '07' THEN 'jul' WHEN '08' THEN 'ago' WHEN '09' THEN 'sep'
           WHEN '10' THEN 'oct' WHEN '11' THEN 'nov' ELSE 'dic' END),
        -- b) años distintos: "31 dic 2026 al 1 ene 2027"
        CAST(substr("startDate", 9, 2) AS INTEGER) || ' ' ||
        (CASE substr("startDate", 6, 2)
           WHEN '01' THEN 'ene' WHEN '02' THEN 'feb' WHEN '03' THEN 'mar'
           WHEN '04' THEN 'abr' WHEN '05' THEN 'may' WHEN '06' THEN 'jun'
           WHEN '07' THEN 'jul' WHEN '08' THEN 'ago' WHEN '09' THEN 'sep'
           WHEN '10' THEN 'oct' WHEN '11' THEN 'nov' ELSE 'dic' END) || ' ' ||
        substr("startDate", 1, 4) || ' al ' ||
        CAST(substr("endDate", 9, 2) AS INTEGER) || ' ' ||
        (CASE substr("endDate", 6, 2)
           WHEN '01' THEN 'ene' WHEN '02' THEN 'feb' WHEN '03' THEN 'mar'
           WHEN '04' THEN 'abr' WHEN '05' THEN 'may' WHEN '06' THEN 'jun'
           WHEN '07' THEN 'jul' WHEN '08' THEN 'ago' WHEN '09' THEN 'sep'
           WHEN '10' THEN 'oct' WHEN '11' THEN 'nov' ELSE 'dic' END) || ' ' ||
        substr("endDate", 1, 4)
      ) THEN NULL
      WHEN "label" = (
        CASE WHEN substr("startDate", 1, 7) = substr("endDate", 1, 7)
          THEN CAST(substr("startDate", 9, 2) AS INTEGER) || ' al ' ||
               CAST(substr("endDate", 9, 2) AS INTEGER) || ' ' ||
               (CASE substr("endDate", 6, 2)
                  WHEN '01' THEN 'ene' WHEN '02' THEN 'feb' WHEN '03' THEN 'mar'
                  WHEN '04' THEN 'abr' WHEN '05' THEN 'may' WHEN '06' THEN 'jun'
                  WHEN '07' THEN 'jul' WHEN '08' THEN 'ago' WHEN '09' THEN 'sep'
                  WHEN '10' THEN 'oct' WHEN '11' THEN 'nov' ELSE 'dic' END)
          ELSE CAST(substr("startDate", 9, 2) AS INTEGER) || ' ' ||
               (CASE substr("startDate", 6, 2)
                  WHEN '01' THEN 'ene' WHEN '02' THEN 'feb' WHEN '03' THEN 'mar'
                  WHEN '04' THEN 'abr' WHEN '05' THEN 'may' WHEN '06' THEN 'jun'
                  WHEN '07' THEN 'jul' WHEN '08' THEN 'ago' WHEN '09' THEN 'sep'
                  WHEN '10' THEN 'oct' WHEN '11' THEN 'nov' ELSE 'dic' END) ||
               ' al ' || CAST(substr("endDate", 9, 2) AS INTEGER) || ' ' ||
               (CASE substr("endDate", 6, 2)
                  WHEN '01' THEN 'ene' WHEN '02' THEN 'feb' WHEN '03' THEN 'mar'
                  WHEN '04' THEN 'abr' WHEN '05' THEN 'may' WHEN '06' THEN 'jun'
                  WHEN '07' THEN 'jul' WHEN '08' THEN 'ago' WHEN '09' THEN 'sep'
                  WHEN '10' THEN 'oct' WHEN '11' THEN 'nov' ELSE 'dic' END)
        END
      ) THEN NULL
      ELSE "label"
    END,
    substr("startDate", 1, 10),
    substr("endDate", 1, 10),
    "createdAt",
    "deletedAt"
FROM "Weekend";

-- 2. Las versiones guardadas y los resguardos, con sus identificadores.
CREATE TABLE "PeriodVersion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "periodId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "data" TEXT NOT NULL,
    "lineCount" INTEGER NOT NULL DEFAULT 0,
    "actorId" TEXT,
    "actorName" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "restoredAt" DATETIME,
    CONSTRAINT "PeriodVersion_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "OperationalPeriod" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "PeriodVersion" ("id", "periodId", "kind", "data", "lineCount", "actorId", "actorName", "createdAt", "restoredAt")
SELECT "id", "weekendId", "kind", "data", "lineCount", "actorId", "actorName", "createdAt", "restoredAt" FROM "WeekendVersion";

CREATE TABLE "PeriodSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "periodId" TEXT NOT NULL,
    "takenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "data" TEXT NOT NULL,
    CONSTRAINT "PeriodSnapshot_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "OperationalPeriod" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "PeriodSnapshot" ("id", "periodId", "takenAt", "data")
SELECT "id", "weekendId", "takenAt", "data" FROM "WeekendSnapshot";

-- 3. El evento: cambia de qué cuelga y se le corrige la hora.
--    Los renglones del pedido NO se tocan: apuntan al id del evento, que no cambia.
PRAGMA defer_foreign_keys=ON;
CREATE TABLE "new_Event" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "periodId" TEXT NOT NULL,
    "lugar" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "guests" INTEGER NOT NULL DEFAULT 0,
    "responsable" TEXT,
    "status" TEXT NOT NULL DEFAULT 'NO_LISTO',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" DATETIME,
    CONSTRAINT "Event_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "OperationalPeriod" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Event" ("id", "periodId", "lugar", "date", "guests", "responsable", "status", "createdAt", "deletedAt")
SELECT
    "id",
    "weekendId",
    "lugar",
    strftime('%Y-%m-%dT%H:%M:%f', "date", '+3 hours') || '+00:00',
    "guests",
    "responsable",
    "status",
    "createdAt",
    "deletedAt"
FROM "Event";
DROP TABLE "Event";
ALTER TABLE "new_Event" RENAME TO "Event";
CREATE INDEX "Event_periodId_deletedAt_idx" ON "Event"("periodId", "deletedAt");
PRAGMA defer_foreign_keys=OFF;

-- 4. Recién ahora se sueltan las tablas viejas: ya no queda nada adentro.
DROP TABLE "WeekendSnapshot";
DROP TABLE "WeekendVersion";
DROP TABLE "Weekend";

-- 5. Índices.
CREATE INDEX "OperationalPeriod_deletedAt_idx" ON "OperationalPeriod"("deletedAt");
CREATE INDEX "OperationalPeriod_startDay_endDay_idx" ON "OperationalPeriod"("startDay", "endDay");
CREATE UNIQUE INDEX "PeriodSnapshot_periodId_key" ON "PeriodSnapshot"("periodId");
CREATE INDEX "PeriodVersion_periodId_createdAt_idx" ON "PeriodVersion"("periodId", "createdAt");

PRAGMA foreign_keys=ON;

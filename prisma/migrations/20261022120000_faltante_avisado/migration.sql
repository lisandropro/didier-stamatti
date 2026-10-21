-- Faltante nuevo: lo último que se avisó que falta de cada producto en cada
-- período, y la marca del primer barrido de cada período.
--
-- Nada existente cambia de valor: la tabla es nueva y `faltantesDesde` arranca
-- nula en todos los períodos. Por eso el primer barrido después del deploy
-- registra los faltantes que ya hay sin avisar.

-- AlterTable
ALTER TABLE "OperationalPeriod" ADD COLUMN "faltantesDesde" DATETIME;

-- CreateTable
CREATE TABLE "FaltanteAvisado" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "periodId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "missing" INTEGER NOT NULL,
    "at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FaltanteAvisado_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "OperationalPeriod" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "FaltanteAvisado_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "FaltanteAvisado_periodId_productId_key" ON "FaltanteAvisado"("periodId", "productId");


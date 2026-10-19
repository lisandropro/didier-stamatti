-- Registro de cada push, para saber a quién le llega y a quién no.
--
-- Hasta acá un push que fallaba se perdía en silencio: del 07/09 al 19/10/2026
-- ningún teléfono pudo activar los avisos y nada lo mostró. Cada intento a cada
-- dispositivo queda ahora como una fila de PushDelivery con su resultado.
-- Las columnas nuevas de PushSubscription son nulas: no cambian ningún dato.

-- AlterTable
ALTER TABLE "PushSubscription" ADD COLUMN "lastErrorAt" DATETIME;
ALTER TABLE "PushSubscription" ADD COLUMN "lastOkAt" DATETIME;
ALTER TABLE "PushSubscription" ADD COLUMN "userAgent" TEXT;

-- CreateTable
CREATE TABLE "PushDelivery" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "notificationId" TEXT,
    "userId" TEXT NOT NULL,
    "subscriptionId" TEXT,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "statusCode" INTEGER,
    "error" TEXT,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "reintentable" BOOLEAN NOT NULL DEFAULT false,
    "retriedAt" DATETIME,
    "payload" TEXT NOT NULL,
    "urgency" TEXT NOT NULL DEFAULT 'normal',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "openedAt" DATETIME
);

-- CreateIndex
CREATE INDEX "PushDelivery_userId_createdAt_idx" ON "PushDelivery"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "PushDelivery_subscriptionId_createdAt_idx" ON "PushDelivery"("subscriptionId", "createdAt");

-- CreateIndex
CREATE INDEX "PushDelivery_status_reintentable_retriedAt_idx" ON "PushDelivery"("status", "reintentable", "retriedAt");

-- CreateIndex
CREATE INDEX "PushDelivery_createdAt_idx" ON "PushDelivery"("createdAt");


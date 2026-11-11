-- Dos cosas, ninguna cambia un dato existente:
--
-- 1. Suggestion.authorId pasa a ser opcional y, al borrar al usuario, queda en
--    NULL (antes: ON DELETE CASCADE). Borrar a una persona se llevaba todas sus
--    sugerencias, con sus respuestas, cuando `authorName` se guarda justamente
--    para que la sugerencia siga diciendo quien la escribio. SQLite no deja
--    cambiar una clave foranea: la tabla se rehace y se copian TODAS las filas
--    y columnas tal cual (las 20), con sus tres indices.
--
-- 2. Un indice por PushDelivery.notificationId, que el barrido de avisos
--    consulta para saber si una tanda ya le llego a algun telefono.

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Suggestion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "authorId" TEXT,
    "authorName" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'NUEVA',
    "screen" TEXT,
    "eventId" TEXT,
    "eventLugar" TEXT,
    "productId" TEXT,
    "contextNote" TEXT,
    "appVersion" TEXT,
    "device" TEXT,
    "reply" TEXT,
    "repliedAt" DATETIME,
    "repliedByName" TEXT,
    "statusAt" DATETIME,
    "clientKey" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Suggestion_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Suggestion" ("appVersion", "authorId", "authorName", "body", "clientKey", "contextNote", "createdAt", "device", "eventId", "eventLugar", "id", "kind", "productId", "repliedAt", "repliedByName", "reply", "screen", "status", "statusAt", "title") SELECT "appVersion", "authorId", "authorName", "body", "clientKey", "contextNote", "createdAt", "device", "eventId", "eventLugar", "id", "kind", "productId", "repliedAt", "repliedByName", "reply", "screen", "status", "statusAt", "title" FROM "Suggestion";
DROP TABLE "Suggestion";
ALTER TABLE "new_Suggestion" RENAME TO "Suggestion";
CREATE UNIQUE INDEX "Suggestion_clientKey_key" ON "Suggestion"("clientKey");
CREATE INDEX "Suggestion_authorId_createdAt_idx" ON "Suggestion"("authorId", "createdAt");
CREATE INDEX "Suggestion_status_createdAt_idx" ON "Suggestion"("status", "createdAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "PushDelivery_notificationId_idx" ON "PushDelivery"("notificationId");

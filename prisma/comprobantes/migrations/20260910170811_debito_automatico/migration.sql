-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Supplier" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "cuit" TEXT,
    "alias" TEXT,
    "diasPago" INTEGER,
    "debitoAutomatico" BOOLEAN NOT NULL DEFAULT false,
    "condicionAcordadaAt" DATETIME,
    "condicionAcordadaPorId" TEXT,
    "condicionAcordadaPorName" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" DATETIME
);
INSERT INTO "new_Supplier" ("active", "alias", "condicionAcordadaAt", "condicionAcordadaPorId", "condicionAcordadaPorName", "createdAt", "cuit", "deletedAt", "diasPago", "id", "name") SELECT "active", "alias", "condicionAcordadaAt", "condicionAcordadaPorId", "condicionAcordadaPorName", "createdAt", "cuit", "deletedAt", "diasPago", "id", "name" FROM "Supplier";
DROP TABLE "Supplier";
ALTER TABLE "new_Supplier" RENAME TO "Supplier";
CREATE UNIQUE INDEX "Supplier_cuit_key" ON "Supplier"("cuit");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

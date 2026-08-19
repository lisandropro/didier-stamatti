-- "Nunca lo contamos" deja de ser cero.
--
-- `stock` pasa a admitir NULL, y NULL significa que ese producto todavía no se
-- inventarió. Antes ambos casos eran el número 0, y el aviso de faltante no
-- podía distinguirlos: gritaba "faltan 130 almohadones" cuando lo cierto era
-- que nadie había contado los almohadones.
--
-- Qué se marca como no contado: los reutilizables en cero que **nunca tuvieron
-- un movimiento de stock**. Un movimiento es la huella de que alguien puso ese
-- número a propósito. Por eso un producto contado que dio cero —hay uno,
-- "Florero con pie", con dos movimientos— conserva su cero, que es un dato.
--
-- Los consumibles no llevan stock: quedan en 0 como estaban, sin tocar.

-- SQLite no permite cambiar la nulabilidad de una columna: se rehace la tabla.
-- Mismo envoltorio que usa Prisma para rehacer tablas: las claves foráneas se
-- difieren mientras la tabla vieja no existe, y se vuelven a activar al final.
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Product" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "rubro" TEXT,
    "type" TEXT NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'Unidad',
    "description" TEXT,
    "stock" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO "new_Product" ("id","name","category","rubro","type","unit","description","stock","active","createdAt")
SELECT
    "id","name","category","rubro","type","unit","description",
    CASE
      WHEN "type" = 'REUTILIZABLE'
       AND "stock" = 0
       AND NOT EXISTS (SELECT 1 FROM "StockMovement" WHERE "StockMovement"."productId" = "Product"."id")
      THEN NULL
      ELSE "stock"
    END,
    "active","createdAt"
FROM "Product";

DROP TABLE "Product";
ALTER TABLE "new_Product" RENAME TO "Product";
CREATE INDEX "Product_category_idx" ON "Product"("category");

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

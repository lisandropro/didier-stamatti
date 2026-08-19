-- Vuelta atrás de "stock sin recuento" (migración 20260819150000).
--
-- Deja `stock` como estaba: NOT NULL con default 0. Los productos marcados como
-- "nunca contados" vuelven a valer 0, que es exactamente lo que valían antes.
-- No se pierde ningún número: la migración de ida nunca tocó los que tenían uno.
--
-- Esto es una vuelta atrás HACIA ADELANTE: no borra la migración de ida del
-- historial. Es a propósito. Si se borrara la carpeta de la migración ya
-- aplicada, `prisma migrate deploy` encontraría en la base una migración que no
-- existe en el repo y se negaría a arrancar el contenedor.
--
-- Cómo usarla, si hiciera falta:
--   1. npm run revertir:sin-recuento -- <ruta-a-la-base>   (primero sobre una copia)
--   2. Copiar esta carpeta a prisma/migrations/20260819160000_revertir_stock_sin_recuento/
--   3. git revert del commit de código, conservando AMBAS carpetas de migración
--   4. Desplegar

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
    "stock" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO "new_Product" ("id","name","category","rubro","type","unit","description","stock","active","createdAt")
SELECT "id","name","category","rubro","type","unit","description",
       COALESCE("stock", 0),
       "active","createdAt"
FROM "Product";

DROP TABLE "Product";
ALTER TABLE "new_Product" RENAME TO "Product";
CREATE INDEX "Product_category_idx" ON "Product"("category");

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

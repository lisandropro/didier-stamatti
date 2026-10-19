import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * Guardas de la preparación sobre el texto de los archivos: las pantallas y
 * acciones leen la sesión de las cookies y no corren fuera de Next.
 */

function fuente(rel: string): string {
  let dir = process.cwd();
  for (let i = 0; i < 5; i++) {
    const candidato = path.join(dir, rel);
    if (fs.existsSync(candidato)) return fs.readFileSync(candidato, "utf8");
    dir = path.dirname(dir);
  }
  throw new Error(`no se encontró ${rel}`);
}

test("la portada lleva al depósito a Preparar en vez de dar 404", () => {
  const s = fuente("app/(app)/page.tsx");
  assert.match(s, /canVerPreparacion\(session\.role\)\) redirect\("\/preparar"\)/);
});

test("Preparar está en el menú lateral y en la barra del teléfono para quien tilda", () => {
  for (const archivo of ["components/Sidebar.tsx", "components/MobileNav.tsx"]) {
    const s = fuente(archivo);
    assert.match(s, /canPreparar\(/, `${archivo} no mira canPreparar`);
    assert.match(s, /"\/preparar"/, `${archivo} no tiene la entrada /preparar`);
  }
});

test("el depósito no pasa ninguna guarda de las acciones que escriben pedidos, stock, catálogo o usuarios", async () => {
  // La spec pide probarlo sobre el texto de las acciones, como order-actions.test.ts:
  // cada guarda que usan esos archivos tiene que dejar afuera al depósito.
  const permisos = (await import("../lib/permissions")) as unknown as Record<string, (r: string) => boolean>;
  for (const archivo of ["order.ts", "period.ts", "snapshot.ts", "stock.ts", "users.ts"]) {
    const s = fuente(`app/actions/${archivo}`);
    const guardas = [...new Set([...s.matchAll(/\b(can[A-Z]\w*)\(/g)].map((m) => m[1]))];
    assert.ok(guardas.length > 0, `${archivo} no usa ninguna guarda`);
    for (const g of guardas) {
      assert.equal(typeof permisos[g], "function", `${archivo}: ${g} no es una capacidad de lib/permissions`);
      assert.equal(permisos[g]("DEPOSITO"), false, `${archivo}: ${g} deja pasar al depósito`);
    }
  }
  // El catálogo no usa una capacidad sino el rol exacto.
  assert.match(fuente("app/actions/products.ts"), /user\.role !== "ADMIN"/);
});

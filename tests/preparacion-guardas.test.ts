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

test("ninguna acción de preparación escribe sin comprobar permiso y evento vivo antes", () => {
  const s = fuente("app/actions/preparacion.ts");
  const guarda = s.slice(s.indexOf("async function requerirPreparar"), s.indexOf("export async function"));
  assert.match(guarda, /canPreparar\(user\.role\)/);
  assert.match(guarda, /deletedAt: null, period: \{ deletedAt: null \}/);
  // El permiso se mira antes de tocar la base: a quien no puede no se le dice
  // ni si el evento existe.
  assert.ok(guarda.indexOf("canPreparar(") < guarda.indexOf("prisma.event.findFirst"), "consulta la base antes del permiso");
  const cortes = [...s.matchAll(/^export async function (\w+)/gm)];
  assert.equal(cortes.length, 3);
  for (let i = 0; i < cortes.length; i++) {
    const cuerpo = s.slice(cortes[i].index!, i + 1 < cortes.length ? cortes[i + 1].index! : s.length);
    const permiso = cuerpo.indexOf("requerirPreparar(");
    const escritura = cuerpo.search(/\b(tildar|destildar|tildarSector)\(eventId/);
    assert.ok(permiso > -1 && escritura > permiso, `${cortes[i][1]} escribe sin comprobar antes`);
    // Llamar a la guarda no alcanza: hay que cortar si no dejó pasar.
    assert.match(cuerpo.slice(permiso, escritura), /if \(!user\) return/, `${cortes[i][1]} ignora lo que dijo la guarda`);
  }
});

test("cada acción del pedido marca si el cambio es tardío antes de avisar", () => {
  const s = fuente("app/actions/order.ts");
  const cuerpo = (nombre: string) => {
    const desde = s.indexOf(`export async function ${nombre}`);
    const resto = s.slice(desde + 10);
    const hasta = resto.search(/^export async function /m);
    return s.slice(desde, hasta === -1 ? s.length : desde + 10 + hasta);
  };
  for (const [nombre, pregunta] of [
    ["setLine", "estaTildado("],
    ["setCustomQty", "estaTildado("],
    ["deleteLine", "estaTildado("],
    ["copyOrderFromEvent", "hayTildados("],
  ] as const) {
    const c = cuerpo(nombre);
    const marca = c.indexOf(pregunta);
    const aviso = c.indexOf("notifyOrderChange(");
    assert.ok(marca > -1 && aviso > marca, `${nombre} avisa sin saber si es tardío`);
    assert.match(c, /tardio/, `${nombre} no pasa la marca`);
  }
  const addCustom = cuerpo("addCustomLine");
  assert.doesNotMatch(addCustom, /tardio: true|estaTildado\(/, "un suelto nuevo nunca es tardío");
});

test("descartar y restaurar avisan como tardío a los eventos que tenían algo tildado", () => {
  const s = fuente("app/actions/snapshot.ts");
  assert.match(s, /preparaciones: \{ some: \{\} \}/);
  assert.match(s, /kind: "RESTAURADO"[\s\S]*tardio: true/);
});

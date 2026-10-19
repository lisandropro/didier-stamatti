import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * Las guardas de las acciones de pedidos, sobre el texto del archivo.
 *
 * Las server actions leen la sesión de las cookies y no corren fuera de Next,
 * así que —igual que `period-crud.test.ts` con los permisos— se lee el archivo
 * y se exige el orden correcto: primero comprobar que el evento esté vivo,
 * después escribir.
 *
 * Hasta el 19/10/2026 `setCustomQty` y `deleteLine` no lo comprobaban: se
 * podía cambiar un ítem de un evento que estaba en la papelera. Y "Repetir
 * pedido" pisaba el pedido sin guardar antes una copia recuperable.
 */

function fuente(rel: string): string {
  let dir = process.cwd();
  for (let i = 0; i < 5; i++) {
    const candidato = path.join(dir, rel);
    if (fs.existsSync(candidato)) return fs.readFileSync(candidato, "utf8");
    dir = path.dirname(dir);
  }
  throw new Error(`no se encontró ${rel} desde ${process.cwd()}`);
}

/** Cuerpo de cada `export async function`, por nombre. */
function acciones(texto: string): Map<string, string> {
  const cortes = [...texto.matchAll(/^export async function (\w+)/gm)];
  const out = new Map<string, string>();
  for (let i = 0; i < cortes.length; i++) {
    const hasta = i + 1 < cortes.length ? cortes[i + 1].index! : texto.length;
    out.set(cortes[i][1], texto.slice(cortes[i].index!, hasta));
  }
  return out;
}

const ESCRITURA = /prisma\.\w+\.(create|update|delete|upsert|createMany|updateMany|deleteMany)\(|prisma\.\$transaction\(|saveRecoverableVersion\(/;
const EVENTO_VIVO = /EVENTO_VIVO|deletedAt: null, period: \{ deletedAt: null \}/;

test("ninguna acción de pedidos escribe sin haber comprobado que el evento esté vivo", () => {
  const todas = acciones(fuente("app/actions/order.ts"));
  assert.ok(todas.size >= 5, `se esperaban las acciones de pedidos, se encontraron ${todas.size}`);
  for (const [nombre, cuerpo] of todas) {
    const escritura = cuerpo.search(ESCRITURA);
    if (escritura === -1) continue;
    const guarda = cuerpo.search(EVENTO_VIVO);
    assert.notEqual(guarda, -1, `${nombre} escribe sin comprobar que el evento no esté en la papelera`);
    assert.ok(guarda < escritura, `${nombre} comprueba el evento DESPUÉS de escribir`);
  }
});

test("repetir un pedido guarda una copia recuperable ANTES de pisar el que había", () => {
  const cuerpo = acciones(fuente("app/actions/order.ts")).get("copyOrderFromEvent");
  assert.ok(cuerpo, "no se encontró copyOrderFromEvent");
  const copia = cuerpo.indexOf('saveRecoverableVersion(');
  const borrado = cuerpo.indexOf("orderLine.deleteMany(");
  assert.notEqual(copia, -1, "copyOrderFromEvent no guarda ninguna copia");
  assert.ok(copia < borrado, "la copia se guarda DESPUÉS de borrar el pedido");
  assert.match(cuerpo, /"PRE_COPIA"/);
});

test("marcar un evento LISTO exige que esté vivo", () => {
  const cuerpo = acciones(fuente("app/actions/period.ts")).get("setEventStatus");
  assert.ok(cuerpo, "no se encontró setEventStatus");
  assert.match(cuerpo, EVENTO_VIVO);
});

test("descartar y restaurar versiones exigen que el período esté vivo", () => {
  const todas = acciones(fuente("app/actions/snapshot.ts"));
  for (const nombre of ["discardPeriodChanges", "restorePeriodVersion"]) {
    const cuerpo = todas.get(nombre);
    assert.ok(cuerpo, `no se encontró ${nombre}`);
    const guarda = cuerpo.search(/deletedAt: null/);
    const escritura = cuerpo.search(/saveRecoverableVersion\(|applySnapshotData\(/);
    assert.notEqual(guarda, -1, `${nombre} no mira la papelera`);
    assert.ok(guarda < escritura, `${nombre} mira la papelera DESPUÉS de escribir`);
  }
});

test("la papelera muestra las copias hechas antes de repetir un pedido con su propio nombre", () => {
  assert.match(fuente("components/PeriodHub.tsx"), /PRE_COPIA/);
});

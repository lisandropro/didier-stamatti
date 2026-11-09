import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * Guardas del levante sobre el texto de los archivos: las acciones y las
 * pantallas leen la sesión de las cookies y no corren fuera de Next.
 */

/** El texto de un archivo, con los fines de línea de Unix: en Windows git los
 *  deja CRLF y los cortes por "\n}\n" no los encontrarían. */
function fuente(rel: string): string {
  let dir = process.cwd();
  for (let i = 0; i < 5; i++) {
    const candidato = path.join(dir, rel);
    if (fs.existsSync(candidato)) return fs.readFileSync(candidato, "utf8").replace(/\r\n/g, "\n");
    dir = path.dirname(dir);
  }
  throw new Error(`no se encontró ${rel}`);
}

/** El cuerpo de una acción exportada: desde su `export async function` hasta la
 *  siguiente (o el final del archivo). */
function cuerpoDe(s: string, nombre: string): string {
  const desde = s.indexOf(`export async function ${nombre}`);
  assert.ok(desde > -1, `no existe ${nombre}`);
  const resto = s.slice(desde + 10);
  const hasta = resto.search(/^export async function /m);
  return s.slice(desde, hasta === -1 ? s.length : desde + 10 + hasta);
}

/** Las escrituras de lib/levante-db.ts que llaman las acciones. */
const ESCRITURA = /\b(marcarVolvio|marcarFalta|desmarcar|marcarSector|terminarLevante|reabrirLevante|descontarFaltante)\(eventId/;

test("la guarda del levante mira el permiso antes que la base, y solo deja un evento vivo", () => {
  const s = fuente("app/actions/levante.ts");
  const desde = s.indexOf("async function requerirEvento");
  assert.ok(desde > -1, "no existe requerirEvento");
  const guarda = s.slice(desde, s.indexOf("\n}", desde));
  assert.match(guarda, /puede\(user\.role\)/);
  assert.match(guarda, /deletedAt: null, period: \{ deletedAt: null \}/);
  assert.ok(guarda.indexOf("puede(user.role)") < guarda.indexOf("prisma.event.findFirst"), "consulta la base antes del permiso");
  // Marcar: los mismos que tildan la preparación.
  assert.match(s, /function requerirMarcar\(eventId: string\): Promise<Guarda> \{\s*return requerirEvento\(eventId, canPreparar,/);
});

test("ninguna acción del levante escribe sin comprobar permiso y evento vivo antes", () => {
  const s = fuente("app/actions/levante.ts");
  const cortes = [...s.matchAll(/^export async function (\w+)/gm)];
  assert.ok(cortes.length >= 4, "faltan acciones");
  for (const [, nombre] of cortes) {
    const cuerpo = cuerpoDe(s, nombre);
    const permiso = cuerpo.search(/requerir(Marcar|Stock)\(eventId\)/);
    const escritura = cuerpo.search(ESCRITURA);
    assert.ok(permiso > -1 && escritura > permiso, `${nombre} escribe sin comprobar antes`);
    // Llamar a la guarda no alcanza: hay que cortar si no dejó pasar.
    assert.match(cuerpo.slice(permiso, escritura), /if \(!user\) return/, `${nombre} ignora lo que dijo la guarda`);
  }
});

test("las acciones de marcar comprueban lo que llega y le pasan lo visto a la escritura", () => {
  const s = fuente("app/actions/levante.ts");
  for (const [nombre, comprueba, pasa] of [
    ["marcarVolvioItem", "validQuantity(mandado, 1)", /marcarVolvio\(eventId, clave, user, mandado\)/],
    ["marcarFaltaItem", "esFaltaValida(faltan, mandado)", /marcarFalta\(eventId, clave, user, mandado, faltan\)/],
    ["desmarcarItem", "validQuantity(faltanVisto)", /desmarcar\(eventId, clave, faltanVisto\)/],
    ["marcarSectorEntero", "sonVistosDeLevante(vistos)", /marcarSector\(eventId, category, user, vistos\)/],
  ] as const) {
    const c = cuerpoDe(s, nombre);
    const valida = c.indexOf(comprueba);
    const escritura = c.search(ESCRITURA);
    assert.ok(valida > -1 && escritura > valida, `${nombre} escribe sin comprobar lo que llega`);
    assert.match(c, pasa, `${nombre} no le pasa lo visto a la escritura`);
  }
});

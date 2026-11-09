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

test("terminar lo deciden los que marcan; reabrir, solo quien toca el stock", () => {
  const s = fuente("app/actions/levante.ts");
  assert.match(cuerpoDe(s, "terminarElLevante"), /requerirMarcar\(eventId\)/);
  assert.match(cuerpoDe(s, "terminarElLevante"), /terminarLevante\(eventId, user, sinRevisarVisto\)/);
  // Un número viejo no termina: vuelve el de ahora para volver a preguntar.
  assert.match(cuerpoDe(s, "terminarElLevante"), /confirmar: r\.sinRevisar/);
  assert.match(cuerpoDe(s, "reabrirElLevante"), /requerirStock\(eventId\)/);
  assert.match(s, /function requerirStock\(eventId: string\): Promise<Guarda> \{\s*return requerirEvento\(eventId, canEditStock,/);
});

test("terminar avisa una sola vez: la marca condicionada y los avisos van en la misma transacción, el push después", () => {
  const s = fuente("lib/levante-db.ts");
  const desde = s.indexOf("export async function terminarLevante");
  assert.ok(desde > -1, "no existe terminarLevante");
  const cuerpo = s.slice(desde, s.indexOf("\n}\n", desde));
  const marca = cuerpo.indexOf("where: { id: eventId, levanteAt: null }");
  const corta = cuerpo.indexOf("if (puesta.count !== 1)");
  const aviso = cuerpo.indexOf("tx.notification.create(");
  const push = cuerpo.indexOf("sendPushToUser(");
  assert.ok(marca > -1 && corta > marca && aviso > corta, "avisa sin saber si esta escritura fue la que terminó");
  assert.ok(push > aviso, "el push sale antes de guardar el aviso");
  assert.match(cuerpo, /canEditStock\(p\.role\)/, "el aviso no va a quien toca el stock");
  assert.match(cuerpo, /id: \{ not: actor\.id \}/, "quien terminó se avisa a sí mismo");
  assert.match(fuente("lib/push.ts"), /\| "LEVANTE"/);
});

test("las pantallas del levante comprueban su permiso; marcar se ofrece solo a quien puede y con el levante abierto", () => {
  const pagina = fuente("app/(app)/preparar/[eventId]/levante/page.tsx");
  assert.match(pagina, /canVerPreparacion\(sesion\.role\)\) notFound\(\)/);
  assert.match(pagina, /deletedAt: null, period: \{ deletedAt: null \}/);
  assert.match(pagina, /puedeMarcar: canPreparar\(sesion\.role\) && !terminado/);
  const c = fuente("components/Levante.tsx");
  assert.match(c, /if \(!data\.puedeMarcar/);
  // "Reabrir" solo a quien toca el stock.
  assert.match(c, /data\.puedeAjustarStock && \(\s*<button[^>]*onClick=\{reabrir\}/);
});

test("Preparar muestra Para levantar, con cada evento llevando a su levante", () => {
  const s = fuente("app/(app)/preparar/page.tsx");
  assert.match(s, /eventosParaLevantar\(\)/);
  assert.match(s, /Para levantar/);
  assert.match(s, /href=\{linkDelLevante\(e\.id\)\}/);
  assert.match(s, /Levante · \{e\.marcados\} de \{e\.total\}/);
});

test("la pantalla del levante manda lo que se ve y no refresca sin señal", () => {
  const c = fuente("components/Levante.tsx");
  assert.match(c, /<RefrescoPeriodico \/>/);
  const desde = c.indexOf("async function correr");
  assert.ok(desde > -1, "no está correr");
  assert.ok(c.slice(desde, c.indexOf("\n  }", desde)).includes("navigator.onLine"), "marcar sin señal y fallar reemplaza la lista por la página de sin conexión");
  // Lo que mostraba la fila viaja con el toque.
  assert.match(c, /marcarVolvioItem\(data\.evento\.id, i\.clave, i\.qty\)/);
  assert.match(c, /desmarcarItem\(data\.evento\.id, i\.clave, 0\)/);
  assert.match(c, /marcarFaltaItem\(data\.evento\.id, h\.clave, h\.qty, n\)/);
  assert.match(c, /desmarcarItem\(data\.evento\.id, h\.clave, h\.faltanVisto\)/);
  assert.match(c, /vistos: s\.filas\.filter\(\(i\) => i\.estado === "PENDIENTE"\)/);
  assert.match(c, /terminarElLevante\(data\.evento\.id, sinRevisarVisto\)/);
  // La hoja se cierra si la fila cambió mientras estaba abierta.
  assert.match(c, /!data\.items\.some\(\(i\) => sigueComoSeAbrio\(hoja, i\)\)\)\) setHoja\(null\)/);
});

test("en el levante el teléfono vibra al marcar, y solo si el toque hace algo", () => {
  const c = fuente("components/Levante.tsx");
  const desde = c.indexOf("function alternar");
  const cuerpo = c.slice(desde, c.indexOf("\n  }", desde));
  assert.ok(cuerpo.includes("vibrar("), "marcar no da ninguna señal física");
  assert.ok(cuerpo.indexOf("vibrar(") > cuerpo.indexOf("return;"), "vibra aunque el toque no haga nada");
  const sector = c.slice(c.indexOf("function tacharSector"), c.indexOf("\n  }", c.indexOf("function tacharSector")));
  assert.ok(sector.includes("vibrar("), "tachar un sector no da ninguna señal física");
});

test("la hoja de cuántos faltan es un formulario: no se cierra deslizando", () => {
  const c = fuente("components/Levante.tsx");
  const desde = c.indexOf('aria-labelledby="lev-hoja-titulo"');
  assert.ok(desde > -1, "no está la hoja de cuántos faltan");
  const apertura = c.slice(c.lastIndexOf("<div", desde), desde);
  assert.match(apertura, /className="modal"\s+data-sin-deslizar/);
});

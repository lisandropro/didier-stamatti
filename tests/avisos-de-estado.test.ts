import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { consolidarCambios, describirCambio } from "../lib/aviso-texto";

/**
 * Marcar un evento listo, volverlo a borrador, borrarlo o recuperarlo no
 * avisaba: quien prepara se enteraba entrando a mirar. Entran por el mismo
 * camino que los cambios del pedido, así heredan las reglas: a todos menos
 * quien lo hizo, una tanda por evento y lo deshecho no se avisa.
 */

const c = (kind: "ESTADO" | "PAPELERA", itemName: string, before: string, after: string) => ({ kind, itemName, before, after });

test("marcarlo listo se lee así", () => {
  assert.equal(describirCambio(c("ESTADO", "Estado", "NO_LISTO", "LISTO")), "Quedó listo");
  assert.equal(describirCambio(c("ESTADO", "Estado", "LISTO", "NO_LISTO")), "Volvió a borrador");
});

test("mandarlo a la papelera y recuperarlo se leen así", () => {
  assert.equal(describirCambio(c("PAPELERA", "Evento", "VIVO", "BORRADO")), "Se borró el evento (se puede recuperar desde la papelera)");
  assert.equal(describirCambio(c("PAPELERA", "Evento", "BORRADO", "VIVO")), "Se recuperó el evento");
});

test("listo y vuelta a borrador en la misma tanda no avisa nada", () => {
  assert.deepEqual(
    consolidarCambios([c("ESTADO", "Estado", "NO_LISTO", "LISTO"), c("ESTADO", "Estado", "LISTO", "NO_LISTO")]),
    [],
  );
});

test("borrado y recuperado en la misma tanda no avisa nada", () => {
  assert.deepEqual(
    consolidarCambios([c("PAPELERA", "Evento", "VIVO", "BORRADO"), c("PAPELERA", "Evento", "BORRADO", "VIVO")]),
    [],
  );
});

function cuerpoDe(archivo: string, funcion: string): string {
  const s = fs.readFileSync(path.join(process.cwd(), archivo), "utf8");
  const desde = s.indexOf(`export async function ${funcion}`);
  assert.notEqual(desde, -1, `no está ${funcion}`);
  const hasta = s.indexOf("\nexport ", desde + 1);
  return s.slice(desde, hasta === -1 ? undefined : hasta);
}

test("las tres acciones avisan, y después de guardar", () => {
  for (const [funcion, kind] of [["setEventStatus", "ESTADO"], ["deleteEvent", "PAPELERA"], ["restoreEvent", "PAPELERA"]] as const) {
    const cuerpo = cuerpoDe("app/actions/period.ts", funcion);
    const aviso = cuerpo.indexOf("notifyOrderChange(");
    assert.notEqual(aviso, -1, `${funcion} no avisa`);
    assert.ok(cuerpo.includes(`kind: "${kind}"`), `${funcion} no avisa con el tipo ${kind}`);
    const escritura = cuerpo.search(/prisma\.(event\.update|event\.updateMany|\$transaction)\(/);
    assert.ok(escritura !== -1 && escritura < aviso, `${funcion} avisa antes de guardar`);
  }
});

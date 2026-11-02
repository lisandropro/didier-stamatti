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
  // No dice "se puede recuperar" a secas: la papelera se vacía sola el lunes
  // (lib/trash.ts), y lo tirado antes del lunes más reciente ya no vuelve.
  assert.equal(describirCambio(c("PAPELERA", "Evento", "VIVO", "BORRADO")), "Se borró el evento (queda en la papelera hasta el lunes)");
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

test("dos aparatos a la vez: setEventStatus escribe condicionado y avisa solo si le tocó cambiarlo a él", () => {
  const cuerpo = cuerpoDe("app/actions/period.ts", "setEventStatus");
  // Leer y después escribir deja que dos teléfonos avisen cada uno su estado y
  // gane solo uno: la escritura tiene que ser la que decide si cambió.
  assert.match(cuerpo, /updateMany\(\{[^}]*status:\s*\{\s*not:\s*status\s*\}/, "la escritura no es condicionada al estado distinto");
  const escritura = cuerpo.indexOf("updateMany(");
  const aviso = cuerpo.indexOf("notifyOrderChange(");
  const condicion = cuerpo.slice(escritura, aviso);
  assert.match(condicion, /\.count\s*===\s*1/, "no avisa solo cuando la escritura cambió una fila");
  assert.doesNotMatch(cuerpo, /antes\.status\s*!==\s*status/, "sigue decidiendo con la lectura previa");
});

test("setEventStatus: si ya estaba así también actualiza la pantalla de quien llegó tarde", () => {
  const cuerpo = cuerpoDe("app/actions/period.ts", "setEventStatus");
  // Ese teléfono tiene una vista vieja por definición (si no, no habría tocado el
  // botón): salir sin revalidar lo deja mirando el estado equivocado.
  assert.match(
    cuerpo,
    /antes\.status\s*===\s*status\)\s*\{[^}]*revalidatePath\("\/"\)[^}]*return\s*\{\s*ok:\s*true\s*\}/,
    "la salida de 'ya estaba así' no revalida",
  );
});

test("dos aparatos a la vez: deleteEvent escribe condicionado a que siga vivo y avisa solo si le tocó borrarlo a él", () => {
  const cuerpo = cuerpoDe("app/actions/period.ts", "deleteEvent");
  // Leer y después escribir sin condición deja que dos teléfonos avisen cada uno
  // "se borró": la escritura tiene que ser la que decide quién lo borró.
  assert.match(cuerpo, /updateMany\(\{\s*where:\s*\{[^}]*deletedAt:\s*null\s*\}/, "la escritura no es condicionada a que siga vivo");
  assert.doesNotMatch(cuerpo, /prisma\.event\.update\(/, "sigue habiendo una escritura sin condición");
  const escritura = cuerpo.indexOf("updateMany(");
  const aviso = cuerpo.indexOf("notifyOrderChange(");
  assert.match(cuerpo.slice(escritura, aviso), /\.count\s*===\s*1/, "no avisa solo cuando la escritura cambió una fila");
  // Si la escritura no cambió nada, otro aparato ya lo borró: la pantalla se actualiza igual.
  assert.match(cuerpo.slice(aviso), /revalidatePath\("\/"\)/, "no revalida");
});

test("dos aparatos a la vez: restoreEvent escribe condicionado a que siga borrado y avisa solo si le tocó recuperarlo a él", () => {
  const cuerpo = cuerpoDe("app/actions/period.ts", "restoreEvent");
  assert.match(cuerpo, /updateMany\(\{\s*where:\s*\{[^}]*deletedAt:\s*\{\s*not:\s*null\s*\}\s*\}/, "la escritura no es condicionada a que siga borrado");
  // Sin condición, recuperar un evento que al leer estaba vivo deshacía en
  // silencio el borrado que otro aparato hizo en el medio.
  assert.doesNotMatch(cuerpo, /prisma\.event\.update\(/, "sigue habiendo una escritura sin condición");
  assert.match(cuerpo, /ev\.deletedAt\s*\?\s*\[\s*prisma\.event\.updateMany/, "toca el evento aunque al leer estuviera vivo");
  const escritura = cuerpo.indexOf("$transaction(");
  const aviso = cuerpo.indexOf("notifyOrderChange(");
  assert.match(cuerpo.slice(escritura, aviso), /\.count\s*===\s*1/, "no avisa solo cuando la escritura cambió una fila");
  assert.doesNotMatch(cuerpo, /if\s*\(ev\.deletedAt\)\s*\{\s*await notifyOrderChange/, "avisa por la lectura previa");
});

const PAGINA_AVISO = "app/(app)/aviso/[id]/page.tsx";
const paginaDelAviso = () => fs.readFileSync(path.join(process.cwd(), PAGINA_AVISO), "utf8");

test("el detalle del aviso traduce el estado y la papelera a palabras, sin tocar lo guardado", () => {
  const s = paginaDelAviso();
  assert.match(s, /function valorLegible\(kind: string, valor: string \| null\)/, "falta valorLegible");
  for (const [codigo, palabra] of [["LISTO", "Listo"], ["NO_LISTO", "Borrador"], ["VIVO", "En su período"], ["BORRADO", "En la papelera"]]) {
    assert.match(s, new RegExp(`${codigo}:\\s*"${palabra}"`), `${codigo} no se traduce a "${palabra}"`);
  }
  // Se traduce al mostrar: las dos columnas pasan por la función.
  assert.match(s, /valorLegible\(c\.kind, c\.before\)/, "la columna Antes muestra el código");
  assert.match(s, /valorLegible\(c\.kind, c\.after\)/, "la columna Ahora muestra el código");
});

test("el chip del estado no sale verde cuando el evento vuelve a borrador", () => {
  const s = paginaDelAviso();
  // Verde para todo el tipo ESTADO hacía que "Volvió a borrador" (el evento deja
  // de estar listo) se viera como una buena noticia. El color sale del valor.
  assert.doesNotMatch(s, /ESTADO:\s*"ok"/, "el tipo ESTADO es verde sin mirar el valor");
  assert.match(s, /kind === "ESTADO"\) return after === "LISTO" \? "ok" : "warn"/, "el color del estado no sale del valor");
  assert.match(s, /claseDelCambio\(c\.kind, c\.after\)/, "el chip no usa el color por valor");
});

test("el aviso que avisa el borrado no dice que se borró después de sus cambios", () => {
  const s = paginaDelAviso();
  assert.match(s, /kind === "PAPELERA" && [a-z]+\.after === "BORRADO"/, "no reconoce el aviso del borrado");
  // La primera frase solo sale cuando el borrado NO es uno de los cambios del aviso.
  const frase = s.indexOf("Se borró después de estos cambios");
  assert.notEqual(frase, -1, "se perdió la frase para los demás avisos");
  assert.match(s.slice(Math.max(0, frase - 200), frase), /!\s*avisaElBorrado|avisaElBorrado\s*\?/, "la frase sale también en el aviso del borrado");
  assert.match(s, /Se puede recuperar desde Períodos → Papelera\./, "se perdió la forma de recuperarlo");
});

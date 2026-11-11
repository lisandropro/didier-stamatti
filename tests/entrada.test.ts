import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { TOPES, esId, limpiar, limpiarTexto, notaOpcional, textoOpcional } from "../lib/entrada";
import { secretoValido } from "../lib/secreto";
import { pareceProduccion, puedeSembrar } from "../lib/seed-guarda";

/**
 * Lo que llega de afuera.
 *
 * Una server action es un endpoint: los tipos de TypeScript dicen lo que manda
 * la pantalla, no lo que puede mandar cualquiera con una sesión. Las acciones
 * más viejas confiaban en el tipo: un `null` donde iba un objeto, o un número
 * donde iba un texto, terminaban en una excepción cruda (un 500) en vez de
 * `{ ok: false, error }`, y un texto de un mega se guardaba entero.
 */

// ---------------------------------------------------------------------------
// Ids y textos
// ---------------------------------------------------------------------------

test("un id es un texto de 1 a 64 caracteres, y nada más", () => {
  for (const bueno of ["a", "cmwaxk1230000abcd", "x".repeat(64)]) assert.equal(esId(bueno), true);
  for (const malo of ["", "x".repeat(65), null, undefined, 7, {}, [], ["abc"], { id: "abc" }, true]) {
    assert.equal(esId(malo), false, `aceptó ${JSON.stringify(malo)}`);
  }
});

test("limpiar recorta, junta los espacios y devuelve null si no hay texto", () => {
  assert.equal(limpiar("  Hola   mundo \n ", 50), "Hola mundo");
  assert.equal(limpiar("abcdef", 3), "abc");
  for (const nada of ["", "   ", null, undefined, 7, {}]) assert.equal(limpiar(nada, 10), null);
  // El de varias líneas conserva los saltos.
  assert.equal(limpiarTexto("  uno\ndos  ", 50), "uno\ndos");
  assert.equal(limpiarTexto(42, 50), null);
});

test("un texto opcional acepta la ausencia, rechaza lo que no es texto y NO recorta en silencio", () => {
  assert.deepEqual(textoOpcional(undefined, 10), { ok: true, valor: null });
  assert.deepEqual(textoOpcional(null, 10), { ok: true, valor: null });
  assert.deepEqual(textoOpcional("   ", 10), { ok: true, valor: null });
  assert.deepEqual(textoOpcional("  El   Carmen ", 10), { ok: true, valor: "El Carmen" });
  assert.deepEqual(textoOpcional("x".repeat(10), 10), { ok: true, valor: "x".repeat(10) });
  // Guardar un nombre distinto del que se escribió es peor que rechazarlo.
  assert.deepEqual(textoOpcional("x".repeat(11), 10), { ok: false });
  for (const malo of [7, {}, [], true]) assert.deepEqual(textoOpcional(malo, 10), { ok: false }, `aceptó ${JSON.stringify(malo)}`);
  // La nota conserva los saltos de línea y tiene su propio tope.
  assert.deepEqual(notaOpcional(" las altas\nsin pie ", 100), { ok: true, valor: "las altas\nsin pie" });
  assert.deepEqual(notaOpcional("x".repeat(TOPES.nota + 1), TOPES.nota), { ok: false });
});

// ---------------------------------------------------------------------------
// Que las acciones de verdad comprueben lo que reciben
// ---------------------------------------------------------------------------

const RAIZ = path.resolve(__dirname, "..");
const fuente = (rel: string) => fs.readFileSync(path.join(RAIZ, rel), "utf8");

/** Cuerpo de cada `export async function`, por nombre. */
function acciones(rel: string): Map<string, string> {
  const texto = fuente(rel);
  const cortes = [...texto.matchAll(/^export async function (\w+)\(([^)]*)\)?/gm)];
  const out = new Map<string, string>();
  for (let i = 0; i < cortes.length; i++) {
    const hasta = i + 1 < cortes.length ? cortes[i + 1].index! : texto.length;
    out.set(cortes[i][1], texto.slice(cortes[i].index!, hasta));
  }
  return out;
}

test("toda acción que recibe un id lo comprueba con esId antes de llegar a la base", () => {
  // Por cada acción, el nombre del parámetro (o del campo del objeto) que trae
  // el id. Si se agrega una acción con ids y no se anota acá, la prueba de abajo
  // ("ninguna acción nueva queda sin anotar") lo hace notar.
  const esperado: Record<string, Record<string, string[]>> = {
    "app/actions/order.ts": {
      setLine: ["input.eventId", "input.productId"],
      addCustomLine: ["input.eventId"],
      setCustomQty: ["lineId"],
      deleteLine: ["lineId"],
      copyOrderFromEvent: ["targetEventId", "sourceEventId"],
    },
    "app/actions/period.ts": {
      updatePeriod: ["input.periodId"],
      deletePeriod: ["periodId"],
      restorePeriod: ["periodId"],
      createEvent: ["elegidoId"],
      updateEvent: ["input.eventId", "elegidoId"],
      setEventStatus: ["eventId"],
      setEventResponsable: ["eventId"],
      deleteEvent: ["eventId"],
      restoreEvent: ["eventId"],
    },
    "app/actions/snapshot.ts": {
      savePeriodSnapshot: ["periodId"],
      discardPeriodChanges: ["periodId"],
      restorePeriodVersion: ["versionId"],
    },
    "app/actions/products.ts": {
      updateProduct: ["input.id"],
      setProductActive: ["id"],
      deleteProduct: ["id"],
      getProductHistory: ["id"],
    },
    "app/actions/suggestions.ts": { setSuggestionStatus: ["id"], replyToSuggestion: ["id"] },
    "app/actions/stock.ts": { updateStock: ["input.productId"] },
    "app/actions/shortages.ts": { getEventShortages: ["eventId"] },
  };
  for (const [archivo, porAccion] of Object.entries(esperado)) {
    const todas = acciones(archivo);
    for (const [accion, ids] of Object.entries(porAccion)) {
      const cuerpo = todas.get(accion);
      assert.ok(cuerpo, `${archivo}: no se encontró ${accion}`);
      const primeraConsulta = cuerpo.search(/prisma\.\w+\.\w+\(|prisma\.\$transaction\(|await (crearEventoUbicado|corregirEvento|saveStock|eventShortages|buildSnapshotData)\(/);
      for (const id of ids) {
        const guarda = cuerpo.indexOf(`esId(${id})`);
        assert.notEqual(guarda, -1, `${archivo}: ${accion} no comprueba ${id} con esId`);
        if (primeraConsulta !== -1) assert.ok(guarda < primeraConsulta, `${archivo}: ${accion} comprueba ${id} DESPUÉS de consultar la base`);
      }
    }
  }
  // Las de preparación y levante pasan todas por una sola guarda del evento.
  for (const archivo of ["app/actions/preparacion.ts", "app/actions/levante.ts"]) {
    assert.match(fuente(archivo), /if \(!esId\(eventId\)\) return \{ user: null, error: "Evento inválido\." \};/, `${archivo}: la guarda del evento no usa esId`);
  }
});

test("el estado de un evento es LISTO o NO_LISTO, y se comprueba antes de escribir", () => {
  const cuerpo = acciones("app/actions/period.ts").get("setEventStatus")!;
  const guarda = cuerpo.search(/status !== "LISTO" && status !== "NO_LISTO"/);
  assert.notEqual(guarda, -1, "setEventStatus guarda cualquier texto como estado");
  assert.ok(guarda < cuerpo.search(/prisma\.event\.updateMany\(/));
});

test("borrar un renglón borra por el id leído de la base, y avisa solo si esta escritura lo borró", () => {
  const cuerpo = acciones("app/actions/order.ts").get("deleteLine")!;
  assert.match(cuerpo, /deleteMany\(\{ where: \{ id: line\.id \} \}\)/, "deleteLine borra por el argumento");
  assert.doesNotMatch(cuerpo, /deleteMany\(\{ where: \{ id: lineId \} \}\)/);
  const borrado = cuerpo.indexOf("deleteMany(");
  const aviso = cuerpo.indexOf("notifyOrderChange(");
  assert.match(cuerpo.slice(borrado, aviso), /borradas === 1/, "avisa aunque otro aparato lo haya borrado antes");
});

test("cambiar la cantidad de un suelto y el responsable de un evento escriben condicionado", () => {
  const cantidad = acciones("app/actions/order.ts").get("setCustomQty")!;
  assert.doesNotMatch(cantidad, /orderLine\.update\(/, "setCustomQty sigue usando un update por id, que lanza si el renglón ya no está");
  assert.match(cantidad, /orderLine\.updateMany\(\{ where: renglonVivo/);
  const responsable = acciones("app/actions/period.ts").get("setEventResponsable")!;
  assert.doesNotMatch(responsable, /prisma\.event\.update\(/);
  assert.match(responsable, /updateMany\(\{\s*where: \{ id: eventId, \.\.\.EVENTO_VIVO, responsable: ev\.responsable \}/);
  assert.match(responsable.slice(responsable.indexOf("updateMany("), responsable.indexOf("notifyOrderChange(")), /r\.count !== 1/);
});

test("guardar la versión segura exige que el período exista y esté vivo", () => {
  const cuerpo = acciones("app/actions/snapshot.ts").get("savePeriodSnapshot")!;
  const guarda = cuerpo.search(/operationalPeriod\.findFirst\(\{ where: \{ id: periodId, deletedAt: null \}/);
  assert.notEqual(guarda, -1);
  assert.ok(guarda < cuerpo.indexOf("periodSnapshot.upsert("));
});

test("los textos que escribe una persona tienen tope en las acciones que los guardan", () => {
  const period = fuente("app/actions/period.ts");
  for (const campo of ["input.label, TOPES.label", "input.lugar, TOPES.lugar", "input.responsable, TOPES.responsable", "responsable, TOPES.responsable"]) {
    assert.ok(period.includes(`textoOpcional(${campo})`), `period.ts no acota ${campo}`);
  }
  assert.match(period, /invitadosDe\(input\.guests\)/);
  const order = fuente("app/actions/order.ts");
  for (const campo of ["textoOpcional(input.name, TOPES.nombre)", "textoOpcional(input.unit, TOPES.unidad)", "notaOpcional(input.note, TOPES.nota)"]) {
    assert.ok(order.includes(campo), `order.ts no usa ${campo}`);
  }
  const products = fuente("app/actions/products.ts");
  for (const campo of ["input.name, TOPES.nombre", "input.description, TOPES.descripcion", "input.rubro, TOPES.rubro", "input.unit, TOPES.unidad"]) {
    assert.ok(products.includes(`textoOpcional(${campo})`), `products.ts no acota ${campo}`);
  }
  // Y `limpiar` vive en un solo lugar: las sugerencias lo importan, no lo copian.
  const sugerencias = fuente("app/actions/suggestions.ts");
  assert.doesNotMatch(sugerencias, /function limpiar/);
  assert.match(sugerencias, /import \{[^}]*limpiar[^}]*\} from "@\/lib\/entrada"/);
});

// ---------------------------------------------------------------------------
// Las dos rutas
// ---------------------------------------------------------------------------

test("el disparador del respaldo exige un secreto de 32 bytes o más y lo compara sin filtrar por tiempo", () => {
  const largo = "s".repeat(32);
  assert.equal(secretoValido(largo, largo), true);
  assert.equal(secretoValido("s".repeat(31) + "x", largo), false);
  assert.equal(secretoValido(largo + "x", largo), false);
  // Corto o sin configurar: no pasa nadie, ni con el valor exacto.
  assert.equal(secretoValido("1234", "1234"), false);
  assert.equal(secretoValido("x".repeat(31), "x".repeat(31)), false);
  for (const sin of [undefined, null, ""]) assert.equal(secretoValido(largo, sin), false);
  for (const sin of [undefined, null, ""]) assert.equal(secretoValido(sin, largo), false);
  // 32 bytes, no 32 caracteres: los acentos pesan dos.
  assert.equal(secretoValido("ñ".repeat(16), "ñ".repeat(16)), true);

  const ruta = fuente("app/api/internal/backup/route.ts");
  assert.match(ruta, /secretoValido\(req\.headers\.get\("x-backup-secret"\), process\.env\.BACKUP_TRIGGER_SECRET\)/);
  assert.doesNotMatch(ruta, /given !== secret/);
  assert.match(fuente("lib/secreto.ts"), /timingSafeEqual\(/);
});

test("el PDF del pedido exige el permiso de ver el stock y que el evento y su período estén vivos", () => {
  const ruta = fuente("app/api/evento/[id]/pdf-file/route.ts");
  const sesion = ruta.indexOf("getSessionUser()");
  const permiso = ruta.indexOf("canVerStock(session.role)");
  const consulta = ruta.indexOf("prisma.event.findFirst(");
  assert.ok(sesion > -1 && permiso > sesion && consulta > permiso, "el orden tiene que ser sesión, permiso, base");
  assert.match(ruta, /findFirst\(\{ where: \{ id, deletedAt: null, period: \{ deletedAt: null \} \} \}\)/);
});

// ---------------------------------------------------------------------------
// El seed
// ---------------------------------------------------------------------------

const VACIA = { eventos: 0, renglones: 0, movimientos: 0 };

test("el seed corre sin preguntar solo sobre una base vacía y fuera de producción", () => {
  assert.deepEqual(puedeSembrar([], {}, VACIA), { ok: true });
  assert.deepEqual(puedeSembrar([], { NODE_ENV: "development" }, VACIA), { ok: true });
});

test("en producción, o sobre una base con trabajo cargado, no corre sin --force", () => {
  for (const env of [{ NODE_ENV: "production" }, { RAILWAY_ENVIRONMENT: "production" }, { RAILWAY_ENVIRONMENT_NAME: "production" }, { RAILWAY_PROJECT_ID: "abc" }]) {
    assert.equal(pareceProduccion(env), true);
    const r = puedeSembrar([], env, VACIA);
    assert.equal(r.ok, false, `corrió con ${JSON.stringify(env)}`);
    assert.match((!r.ok && r.motivo) || "", /--force/);
    assert.deepEqual(puedeSembrar(["--force"], env, VACIA), { ok: true });
  }
  for (const datos of [{ ...VACIA, eventos: 1 }, { ...VACIA, renglones: 40 }, { ...VACIA, movimientos: 3 }]) {
    const r = puedeSembrar([], {}, datos);
    assert.equal(r.ok, false, `corrió con ${JSON.stringify(datos)}`);
    assert.match((!r.ok && r.motivo) || "", /borra/);
    assert.deepEqual(puedeSembrar(["--force"], {}, datos), { ok: true });
  }
});

test("el seed pregunta antes de borrar nada", () => {
  const seed = fuente("prisma/seed.ts");
  const guarda = seed.indexOf("puedeSembrar(");
  const borrado = seed.indexOf("prisma.orderLine.deleteMany()");
  assert.ok(guarda > -1 && borrado > guarda, "el seed borra antes de mirar contra qué base corre");
  assert.match(seed.slice(guarda, borrado), /if \(!permiso\.ok\) throw new Error\(permiso\.motivo\);/);
});

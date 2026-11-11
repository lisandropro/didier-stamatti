import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { crearBaseDescartable } from "./helpers/base-descartable";
import { instanteDe, sumarDias } from "../lib/dates";

/**
 * Descartar cambios y restaurar una versión, contra una base de verdad.
 *
 * Dos cosas que se rompían en silencio, las dos en períodos ya terminados (que
 * es donde se descarta, y donde al mismo tiempo se está haciendo el levante):
 *
 *  1. Si un producto de la versión se había eliminado del catálogo, recrear su
 *     renglón chocaba con la clave foránea, el lote entero volvía atrás y ese
 *     período no se podía descartar ni restaurar nunca más.
 *  2. Los ítems sueltos volvían con otro id. Lo que el depósito les tildó y lo
 *     que se les marcó en el levante cuelga de ese id: un "faltan 2" se perdía.
 */

const base = crearBaseDescartable("snapshot-restaurar");
let prisma: typeof import("../lib/db").prisma;
let snap: typeof import("../lib/snapshot");
let levante: typeof import("../lib/levante-db");
let prep: typeof import("../lib/preparacion-db");

const HOY = "2026-11-10";
const AYER = sumarDias(HOY, -1);
const PABLO = { id: "u-pablo", name: "Pablo" };

before(async () => {
  ({ prisma } = await import("../lib/db"));
  snap = await import("../lib/snapshot");
  levante = await import("../lib/levante-db");
  prep = await import("../lib/preparacion-db");
});

after(async () => {
  await prisma?.$disconnect();
  base.borrar();
});

let n = 0;
/** Un período con un evento de ayer, una copa del catálogo y un mantel suelto. */
async function escenario() {
  n++;
  const periodo = await prisma.operationalPeriod.create({ data: { startDay: sumarDias(HOY, -3), endDay: AYER } });
  const evento = await prisma.event.create({ data: { periodId: periodo.id, lugar: `Salón ${n}`, date: instanteDe(AYER, "21:00") } });
  const copa = await prisma.product.create({ data: { name: `Copa ${n}`, category: "ENSERES", type: "REUTILIZABLE", stock: 200 } });
  const lCopa = await prisma.orderLine.create({ data: { eventId: evento.id, productId: copa.id, qty: 40 } });
  const lMantel = await prisma.orderLine.create({
    data: { eventId: evento.id, customName: "Mantel bordó", customCategory: "MANTELERIA", customUnit: "Unidad", qty: 10, note: "planchados" },
  });
  return { periodo: periodo.id, evento: evento.id, copa: copa.id, lCopa: lCopa.id, lMantel: lMantel.id, claveMantel: `custom:${lMantel.id}` };
}

const lineas = (eventId: string) => prisma.orderLine.findMany({ where: { eventId }, orderBy: { qty: "asc" } });

// ---------------------------------------------------------------------------
// Un producto que ya no existe
// ---------------------------------------------------------------------------

test("un producto eliminado del catálogo se saltea y se cuenta; el resto del pedido vuelve", async () => {
  const e = await escenario();
  // Un producto sin contar: no deja movimiento de stock, así que se puede
  // eliminar de verdad en cuanto sale del pedido.
  const brasero = await prisma.product.create({ data: { name: `Brasero ${n}`, category: "ENSERES", type: "REUTILIZABLE", stock: null } });
  await prisma.orderLine.create({ data: { eventId: e.evento, productId: brasero.id, qty: 4 } });
  const { data } = await snap.buildSnapshotData(e.periodo);

  // Después de guardar la versión: se saca del pedido, se cambia otra cantidad
  // y el producto se elimina del catálogo.
  await prisma.orderLine.deleteMany({ where: { eventId: e.evento, productId: brasero.id } });
  await prisma.orderLine.update({ where: { id: e.lCopa }, data: { qty: 55 } });
  await prisma.product.delete({ where: { id: brasero.id } });

  const r = await snap.applySnapshotData(e.periodo, data);
  assert.deepEqual(r, { restauradas: 2, omitidas: 1 });
  const quedo = await lineas(e.evento);
  assert.deepEqual(quedo.map((l) => [l.productId ?? l.customName, l.qty]), [["Mantel bordó", 10], [e.copa, 40]]);
});

test("un producto dado de baja (inactivo) sigue existiendo: vuelve y no cuenta como omitido", async () => {
  const e = await escenario();
  const { data } = await snap.buildSnapshotData(e.periodo);
  await prisma.product.update({ where: { id: e.copa }, data: { active: false } });
  await prisma.orderLine.deleteMany({ where: { eventId: e.evento } });
  assert.deepEqual(await snap.applySnapshotData(e.periodo, data), { restauradas: 2, omitidas: 0 });
});

test("una versión ilegible no toca el pedido y lo dice con un mensaje que se puede mostrar", async () => {
  const e = await escenario();
  for (const roto of ["", "{", "{}", "[1]", '[{"eventId":"x","productId":null}]', '[{"eventId":"x","productId":7,"qty":1}]']) {
    await assert.rejects(snap.applySnapshotData(e.periodo, roto), { message: snap.VERSION_ILEGIBLE }, `aceptó ${JSON.stringify(roto)}`);
  }
  assert.equal((await lineas(e.evento)).length, 2, "una versión rota borró el pedido");
});

// ---------------------------------------------------------------------------
// Cada renglón vuelve con su id
// ---------------------------------------------------------------------------

test("los renglones vuelven con el mismo id, también el ítem suelto", async () => {
  const e = await escenario();
  const { data } = await snap.buildSnapshotData(e.periodo);
  await prisma.orderLine.update({ where: { id: e.lMantel }, data: { qty: 12 } });
  await prisma.orderLine.delete({ where: { id: e.lCopa } });

  await snap.applySnapshotData(e.periodo, data);
  const quedo = await lineas(e.evento);
  assert.deepEqual(quedo.map((l) => [l.id, l.qty, l.note]), [[e.lMantel, 10, "planchados"], [e.lCopa, 40, null]]);
});

test("descartar no pierde lo marcado en el levante ni lo tildado de un ítem suelto", async () => {
  const e = await escenario();
  const { data } = await snap.buildSnapshotData(e.periodo);
  assert.equal(await prep.tildar(e.evento, e.claveMantel, PABLO, { estado: "PENDIENTE", qty: 10, note: "planchados" }), "tildado");
  assert.equal(await levante.marcarFalta(e.evento, e.claveMantel, PABLO, 10, 2), "marcado");
  assert.equal(await levante.marcarVolvio(e.evento, e.copa, PABLO, 40), "marcado");

  await snap.applySnapshotData(e.periodo, data);
  // Con el id conservado no hay nada que reasignar: las dos tienen que dar 0.
  assert.equal(await prep.reasignarSueltos(e.periodo), 0);
  assert.equal(await levante.reasignarSueltosDeLevante(e.periodo), 0);

  const items = await levante.levanteDelEvento(e.evento);
  const mantel = items.find((i) => i.clave === e.claveMantel);
  assert.equal(mantel?.estado, "FALTA", "el faltante del suelto se perdió al descartar");
  assert.equal(mantel?.faltan, 2);
  assert.equal(items.find((i) => i.clave === e.copa)?.estado, "VOLVIO");
  const tildado = (await prep.estadoDelEvento(e.evento)).find((i) => i.clave === e.claveMantel);
  assert.equal(tildado?.estado, "PREPARADO", "lo tildado del suelto se perdió al descartar");
});

test("si el id de la versión está ocupado por un renglón de otro lado, nace con uno nuevo y no falla", async () => {
  const e = await escenario();
  const otro = await escenario();
  const { data } = await snap.buildSnapshotData(e.periodo);
  // Una versión que nombra, para este período, un id que hoy usa un renglón de
  // otro período. No debería pasar; si pasa, no puede volver atrás todo.
  const trucado = JSON.stringify(
    (JSON.parse(data) as { id: string; productId: string | null }[]).map((l) => (l.productId === null ? { ...l, id: otro.lMantel } : l)),
  );
  assert.deepEqual(await snap.applySnapshotData(e.periodo, trucado), { restauradas: 2, omitidas: 0 });
  const mantel = (await lineas(e.evento)).find((l) => l.productId === null);
  assert.ok(mantel && mantel.id !== otro.lMantel);
  assert.equal((await prisma.orderLine.findUnique({ where: { id: otro.lMantel } }))?.eventId, otro.evento, "se llevó el renglón del otro período");
});

// ---------------------------------------------------------------------------
// Las versiones guardadas antes: sin id
// ---------------------------------------------------------------------------

test("una versión vieja (sin id) recrea el suelto con otro id, y la marca del levante se pasa a su renglón nuevo", async () => {
  const e = await escenario();
  const { data } = await snap.buildSnapshotData(e.periodo);
  const vieja = JSON.stringify(
    (JSON.parse(data) as Record<string, unknown>[]).map((l) => {
      const sinId = { ...l };
      delete sinId.id;
      return sinId;
    }),
  );
  assert.equal(await levante.marcarFalta(e.evento, e.claveMantel, PABLO, 10, 3), "marcado");

  assert.deepEqual(await snap.applySnapshotData(e.periodo, vieja), { restauradas: 2, omitidas: 0 });
  const mantel = (await lineas(e.evento)).find((l) => l.productId === null)!;
  assert.notEqual(mantel.id, e.lMantel, "una versión sin id no puede reusar el id");
  // Hasta acá la marca quedó huérfana: el ítem se ve sin revisar.
  assert.equal((await levante.levanteDelEvento(e.evento)).find((i) => i.clave === `custom:${mantel.id}`)?.estado, "PENDIENTE");

  assert.equal(await levante.reasignarSueltosDeLevante(e.periodo), 1);
  const item = (await levante.levanteDelEvento(e.evento)).find((i) => i.clave === `custom:${mantel.id}`);
  assert.equal(item?.estado, "FALTA");
  assert.equal(item?.faltan, 3);
  // Otra corrida no encuentra nada más que mover.
  assert.equal(await levante.reasignarSueltosDeLevante(e.periodo), 0);
});

test("la marca de un suelto que de verdad se fue del pedido no se le pega a otro distinto", async () => {
  const e = await escenario();
  assert.equal(await levante.marcarFalta(e.evento, e.claveMantel, PABLO, 10, 1), "marcado");
  await prisma.orderLine.delete({ where: { id: e.lMantel } });
  await prisma.orderLine.create({ data: { eventId: e.evento, customName: "Camino de mesa", customCategory: "MANTELERIA", customUnit: "Unidad", qty: 10 } });
  assert.equal(await levante.reasignarSueltosDeLevante(e.periodo), 0);
});

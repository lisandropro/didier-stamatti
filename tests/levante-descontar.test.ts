import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { crearBaseDescartable } from "./helpers/base-descartable";
import { instanteDe, sumarDias } from "../lib/dates";

/**
 * Descontar del stock lo que no volvió, contra una base de verdad: una sola vez
 * por renglón aunque toquen dos teléfonos, por el mismo camino que el ajuste de
 * Inventario, y solo lo que se puede descontar.
 */

const base = crearBaseDescartable("levante-descontar");
let prisma: typeof import("../lib/db").prisma;
let db: typeof import("../lib/levante-db");
const HOY = "2026-11-10";
const AYER = sumarDias(HOY, -1);
let ids: { periodo: string; evento: string; ana: string };
let pablo: { id: string; name: string };
let ana: { id: string; name: string };

before(async () => {
  ({ prisma } = await import("../lib/db"));
  db = await import("../lib/levante-db");
  const mk = (name: string, role: string) =>
    prisma.user.create({ data: { name, email: `${name.toLowerCase()}@test.local`, role, passwordHash: "x" } });
  const uAna = await mk("Ana", "ADMIN");
  const uPablo = await mk("Pablo", "LOGISTICA");
  const periodo = await prisma.operationalPeriod.create({ data: { startDay: sumarDias(HOY, -3), endDay: HOY } });
  const evento = await prisma.event.create({ data: { periodId: periodo.id, lugar: "MUSEO", date: instanteDe(AYER, "21:00") } });
  ids = { periodo: periodo.id, evento: evento.id, ana: uAna.id };
  pablo = { id: uPablo.id, name: "Pablo" };
  ana = { id: uAna.id, name: "Ana" };
});

after(async () => {
  await prisma?.$disconnect();
  base.borrar();
});

/** Un producto en el pedido del evento principal, con `faltan` marcados. */
async function faltante(name: string, stock: number | null, mandado: number, faltan: number): Promise<string> {
  const p = await prisma.product.create({ data: { name, category: "ENSERES", type: "REUTILIZABLE", stock } });
  await prisma.orderLine.create({ data: { eventId: ids.evento, productId: p.id, qty: mandado } });
  await db.marcarFalta(ids.evento, p.id, pablo, mandado, faltan);
  return p.id;
}
const stockDe = async (id: string) => (await prisma.product.findUniqueOrThrow({ where: { id } })).stock;
const movimientos = (productId: string) => prisma.stockMovement.findMany({ where: { productId } });
const terminar = () => prisma.event.update({ where: { id: ids.evento }, data: { levanteAt: new Date(), levantePorName: "Pablo" } });
const reabrir = () => prisma.event.update({ where: { id: ids.evento }, data: { levanteAt: null, levantePorName: null } });

test("con el levante abierto no se descuenta nada", async () => {
  const copa = await faltante("Copa abierta", 100, 40, 5);
  assert.equal(await db.descontarFaltante(ids.evento, copa, "ROTURA", ana), "abierto");
  assert.equal(await stockDe(copa), 100);
  assert.equal((await movimientos(copa)).length, 0);
});

test("descontar baja el stock, deja el movimiento y marca el renglón", async () => {
  const copa = await faltante("Copa vino", 250, 40, 5);
  await terminar();
  assert.equal(await db.descontarFaltante(ids.evento, copa, "ROTURA", ana), "descontado");
  assert.equal(await stockDe(copa), 245);
  const [m] = await movimientos(copa);
  assert.deepEqual([m.delta, m.reason, m.note, m.userId], [-5, "ROTURA", "Levante de MUSEO 9/11", ids.ana]);
  const fila = await prisma.levante.findUniqueOrThrow({ where: { eventId_clave: { eventId: ids.evento, clave: copa } } });
  assert.deepEqual([fila.descontadoMotivo, fila.descontadoPorName, fila.descontadoPorId], ["ROTURA", "Ana", ids.ana]);
  assert.ok(fila.descontadoAt);
  const item = (await db.levanteDelEvento(ids.evento)).find((i) => i.clave === copa);
  assert.equal(item?.descontado?.motivo, "ROTURA");
  // Una segunda vez no descuenta de nuevo.
  assert.equal(await db.descontarFaltante(ids.evento, copa, "PERDIDA", ana), "ya");
  assert.equal(await stockDe(copa), 245);
  assert.equal((await movimientos(copa)).length, 1);
  await reabrir();
});

test("dos teléfonos descuentan a la vez: el stock baja una sola vez", async () => {
  const mantel = await faltante("Mantel redondo", 10, 6, 2);
  await terminar();
  const r = await Promise.all([
    db.descontarFaltante(ids.evento, mantel, "PERDIDA", ana),
    db.descontarFaltante(ids.evento, mantel, "PERDIDA", ana),
  ]);
  assert.deepEqual(r.sort(), ["descontado", "ya"]);
  assert.equal(await stockDe(mantel), 8);
  assert.equal((await movimientos(mantel)).length, 1);
  await reabrir();
});

test("si el evento llevó más de lo que hay, el stock queda en 0 y el movimiento dice lo que bajó", async () => {
  const silla = await faltante("Silla alquilada", 3, 20, 5);
  await terminar();
  assert.equal(await db.descontarFaltante(ids.evento, silla, "PERDIDA", ana), "descontado");
  assert.equal(await stockDe(silla), 0);
  assert.equal((await movimientos(silla))[0].delta, -3);
  await reabrir();
});

test("lo que no se puede descontar queda anotado y no toca el stock", async () => {
  const sinContar = await faltante("Brasero sin contar", null, 4, 1);
  const enCero = await faltante("Florero", 0, 4, 1);
  const volvio = await prisma.product.create({ data: { name: "Plato", category: "ENSERES", type: "REUTILIZABLE", stock: 50 } });
  await prisma.orderLine.create({ data: { eventId: ids.evento, productId: volvio.id, qty: 10 } });
  await db.marcarVolvio(ids.evento, volvio.id, pablo, 10);
  const suelto = await prisma.orderLine.create({ data: { eventId: ids.evento, customName: "Bandeja", customCategory: "ENSERES", qty: 3 } });
  await db.marcarFalta(ids.evento, `custom:${suelto.id}`, pablo, 3, 1);
  await terminar();
  assert.equal(await db.descontarFaltante(ids.evento, sinContar, "ROTURA", ana), "SIN_CONTAR");
  assert.equal(await db.descontarFaltante(ids.evento, enCero, "ROTURA", ana), "SIN_STOCK");
  assert.equal(await db.descontarFaltante(ids.evento, `custom:${suelto.id}`, "ROTURA", ana), "SUELTO");
  assert.equal(await db.descontarFaltante(ids.evento, volvio.id, "ROTURA", ana), "no-existe", "descontó algo que volvió");
  assert.equal(await stockDe(sinContar), null);
  assert.equal(await stockDe(enCero), 0);
  assert.equal(await stockDe(volvio.id), 50);
  assert.equal(await prisma.levante.count({ where: { eventId: ids.evento, descontadoAt: { not: null }, clave: { in: [sinContar, enCero, volvio.id, `custom:${suelto.id}`] } } }), 0);
  await reabrir();
});

test("lo descontado queda aunque se reabra el levante, y no se vuelve a marcar", async () => {
  const vaso = await faltante("Vaso", 30, 12, 2);
  await terminar();
  assert.equal(await db.descontarFaltante(ids.evento, vaso, "ROTURA", ana), "descontado");
  await reabrir();
  assert.equal(await db.marcarVolvio(ids.evento, vaso, pablo, 12), "descontado");
  assert.equal(await db.descontarFaltante(ids.evento, vaso, "ROTURA", ana), "abierto");
  const item = (await db.levanteDelEvento(ids.evento)).find((i) => i.clave === vaso);
  assert.deepEqual([item?.estado, item?.faltan, item?.descontado?.motivo], ["FALTA", 2, "ROTURA"]);
  assert.equal(await stockDe(vaso), 28);
});

test("una marca que llega tarde no pisa un renglón ya descontado", async () => {
  const jarra = await faltante("Jarra", 20, 8, 3);
  await terminar();
  assert.equal(await db.descontarFaltante(ids.evento, jarra, "PERDIDA", ana), "descontado");
  await reabrir();
  // La marca vieja (otro teléfono, otra cantidad) llega después del descuento.
  assert.equal(await db.marcarFalta(ids.evento, jarra, pablo, 8, 1), "descontado");
  assert.equal(await db.marcarVolvio(ids.evento, jarra, pablo, 8), "descontado");
  await db.marcarSector(ids.evento, "ENSERES", pablo, [{ clave: jarra, qty: 8 }]);
  const fila = await prisma.levante.findUniqueOrThrow({ where: { eventId_clave: { eventId: ids.evento, clave: jarra } } });
  assert.deepEqual([fila.faltan, fila.descontadoMotivo], [3, "PERDIDA"]);
  assert.equal(await stockDe(jarra), 17);
});

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { crearBaseDescartable } from "./helpers/base-descartable";
import { instanteDe, hoy, sumarDias } from "../lib/dates";

/**
 * Tildar, destildar y leer la preparación contra una base de verdad.
 */

const base = crearBaseDescartable("preparacion-db");
let prisma: typeof import("../lib/db").prisma;
let db: typeof import("../lib/preparacion-db");
let shortages: typeof import("../lib/shortages");
const PABLO = { id: "u-pablo", name: "Pablo" };
let ids: { periodo: string; evento: string; copa: string; mesa: string; suelto: string };

before(async () => {
  ({ prisma } = await import("../lib/db"));
  db = await import("../lib/preparacion-db");
  shortages = await import("../lib/shortages");
  const periodo = await prisma.operationalPeriod.create({ data: { startDay: hoy(), endDay: sumarDias(hoy(), 2) } });
  const evento = await prisma.event.create({
    data: { periodId: periodo.id, lugar: "El Carmen", date: instanteDe(hoy(), "21:00"), guests: 100 },
  });
  const copa = await prisma.product.create({ data: { name: "Copa de agua", category: "ENSERES", type: "REUTILIZABLE", stock: 250 } });
  const mesa = await prisma.product.create({ data: { name: "Mesa redonda", category: "MOBILIARIO", type: "REUTILIZABLE", stock: 10 } });
  await prisma.orderLine.create({ data: { eventId: evento.id, productId: copa.id, qty: 300, note: "las altas" } });
  await prisma.orderLine.create({ data: { eventId: evento.id, productId: mesa.id, qty: 12 } });
  const suelto = await prisma.orderLine.create({
    data: { eventId: evento.id, customName: "Hielo", customCategory: "BEBIDA", customUnit: "Bolsa", qty: 20 },
  });
  ids = { periodo: periodo.id, evento: evento.id, copa: copa.id, mesa: mesa.id, suelto: `custom:${suelto.id}` };
});

after(async () => {
  await prisma?.$disconnect();
  base.borrar();
});

const estadoDe = async (clave: string) => (await db.estadoDelEvento(ids.evento)).find((i) => i.clave === clave);

test("todo arranca pendiente, con nombre, unidad y sector del producto o del suelto", async () => {
  const items = await db.estadoDelEvento(ids.evento);
  assert.equal(items.length, 3);
  assert.ok(items.every((i) => i.estado === "PENDIENTE"));
  const hielo = items.find((i) => i.clave === ids.suelto)!;
  assert.deepEqual([hielo.itemName, hielo.unit, hielo.category], ["Hielo", "Bolsa", "BEBIDA"]);
});

test("tildar copia lo que había en el pedido y lo deja preparado", async () => {
  assert.equal(await db.tildar(ids.evento, ids.copa, PABLO), "tildado");
  const fila = await prisma.preparacion.findUnique({ where: { eventId_clave: { eventId: ids.evento, clave: ids.copa } } });
  assert.deepEqual([fila?.qty, fila?.note, fila?.itemName, fila?.porName], [300, "las altas", "Copa de agua", "Pablo"]);
  assert.equal((await estadoDe(ids.copa))?.estado, "PREPARADO");
  assert.equal(await db.estaTildado(prisma, ids.evento, ids.copa), true);
  assert.equal(await db.hayTildados(prisma, ids.evento), true);
});

test("si el pedido cambia después, el estado lo dice y volver a tildar lo pone al día", async () => {
  await prisma.orderLine.updateMany({ where: { eventId: ids.evento, productId: ids.copa }, data: { qty: 314, note: "las bajas" } });
  const i = await estadoDe(ids.copa);
  assert.equal(i?.estado, "CAMBIO");
  assert.equal(i?.accion, "Sumá 14");
  await db.tildar(ids.evento, ids.copa, { id: "u-ana", name: "Ana" });
  assert.equal((await estadoDe(ids.copa))?.estado, "PREPARADO");
  // Volver a tildar guarda la cantidad Y la nota nuevas, y quién lo hizo.
  const fila = await prisma.preparacion.findUnique({ where: { eventId_clave: { eventId: ids.evento, clave: ids.copa } } });
  assert.deepEqual([fila?.qty, fila?.note, fila?.porName], [314, "las bajas", "Ana"]);
});

test("si el renglón se borra, lo tildado pide sacarlo; tildarlo de nuevo lo da por sacado", async () => {
  await db.tildar(ids.evento, ids.mesa, PABLO);
  await prisma.orderLine.deleteMany({ where: { eventId: ids.evento, productId: ids.mesa } });
  assert.equal((await estadoDe(ids.mesa))?.estado, "SACAR");
  assert.equal(await db.tildar(ids.evento, ids.mesa, PABLO), "sacado");
  assert.equal(await estadoDe(ids.mesa), undefined);
});

test("tildar algo que no está ni tildado ni en el pedido no hace nada", async () => {
  assert.equal(await db.tildar(ids.evento, "no-existe", PABLO), "no-existe");
});

test("destildar borra la fila: es para errores de quien tilda", async () => {
  assert.equal(await db.destildar(ids.evento, ids.copa), true);
  assert.equal((await estadoDe(ids.copa))?.estado, "PENDIENTE");
  assert.equal(await db.destildar(ids.evento, ids.copa), false);
});

test("tildar un sector toma solo lo pendiente de ese sector", async () => {
  await db.tildar(ids.evento, ids.suelto, PABLO);
  await prisma.orderLine.updateMany({ where: { eventId: ids.evento, customName: "Hielo" }, data: { qty: 25 } });
  assert.equal(await db.tildarSector(ids.evento, "BEBIDA", PABLO), 0, "el Hielo cambió: se confirma de a uno");
  assert.equal(await db.tildarSector(ids.evento, "ENSERES", PABLO), 1);
  assert.equal((await estadoDe(ids.copa))?.estado, "PREPARADO");
  assert.equal((await estadoDe(ids.suelto))?.estado, "CAMBIO");
});

test("borrar el evento borra lo tildado", async () => {
  const otro = await prisma.event.create({ data: { periodId: ids.periodo, lugar: "Otro", date: instanteDe(hoy(), "20:00") } });
  await prisma.preparacion.create({
    data: { eventId: otro.id, clave: "x", itemName: "X", unit: "Unidad", category: "ENSERES", qty: 1, porName: "Pablo" },
  });
  await prisma.event.delete({ where: { id: otro.id } });
  assert.equal(await prisma.preparacion.count({ where: { eventId: otro.id } }), 0);
});

test("eventos para preparar: desde hoy hasta 14 días, vivos, con su avance y lo que hay que aplicar", async () => {
  const lejos = await prisma.event.create({
    data: { periodId: ids.periodo, lugar: "Lejos", date: instanteDe(sumarDias(hoy(), 20), "21:00") },
  });
  const ayer = await prisma.event.create({
    data: { periodId: ids.periodo, lugar: "Ayer", date: instanteDe(sumarDias(hoy(), -1), "21:00") },
  });
  const borrado = await prisma.event.create({
    data: { periodId: ids.periodo, lugar: "Borrado", date: instanteDe(hoy(), "22:00"), deletedAt: new Date() },
  });
  // Los bordes: el día 14 entra, el 15 ya no. Es el error más fácil de cometer.
  const ultimo = await prisma.event.create({
    data: { periodId: ids.periodo, lugar: "Día 14", date: instanteDe(sumarDias(hoy(), 14), "23:30") },
  });
  const pasado = await prisma.event.create({
    data: { periodId: ids.periodo, lugar: "Día 15", date: instanteDe(sumarDias(hoy(), 15), "00:30") },
  });
  try {
    const lista = await db.eventosParaPreparar();
    const lugares = lista.map((e) => e.lugar);
    assert.ok(lugares.includes("El Carmen"));
    assert.ok(lugares.includes("Día 14"), "el día 14 tiene que entrar");
    for (const no of ["Lejos", "Ayer", "Borrado", "Día 15"]) assert.ok(!lugares.includes(no), `no tenía que aparecer ${no}`);
    assert.deepEqual(lista.map((e) => e.date.getTime()), [...lista.map((e) => e.date.getTime())].sort((a, b) => a - b), "por fecha");
    const carmen = lista.find((e) => e.lugar === "El Carmen")!;
    assert.equal(carmen.cambiosParaAplicar, 1, "el Hielo que cambió");
    assert.deepEqual(carmen.avance.find((a) => a.category === "ENSERES"), { category: "ENSERES", label: "Enseres", listos: 1, total: 1 });
  } finally {
    await prisma.event.deleteMany({ where: { id: { in: [lejos.id, ayer.id, borrado.id, ultimo.id, pasado.id] } } });
  }
});

test("faltantes del período: lo pedido entre todos contra el stock", async () => {
  // Otro evento vivo del mismo período suma; uno en la papelera, no.
  const vivo = await prisma.event.create({ data: { periodId: ids.periodo, lugar: "Otro vivo", date: instanteDe(hoy(), "20:00") } });
  const tirado = await prisma.event.create({
    data: { periodId: ids.periodo, lugar: "Tirado", date: instanteDe(hoy(), "20:00"), deletedAt: new Date() },
  });
  await prisma.orderLine.create({ data: { eventId: vivo.id, productId: ids.copa, qty: 10 } });
  await prisma.orderLine.create({ data: { eventId: tirado.id, productId: ids.copa, qty: 1000 } });
  try {
    const filas = await shortages.periodShortages(ids.periodo);
    const copa = filas.find((f) => f.productId === ids.copa)!;
    assert.deepEqual([copa.totalRequested, copa.stock, copa.missing], [324, 250, 74]);
    // La mesa tiene stock 10 y se pedían 12: si siguiera en el pedido, faltaría.
    assert.equal(filas.some((f) => f.productId === ids.mesa), false, "la mesa ya no está en el pedido");
  } finally {
    await prisma.event.deleteMany({ where: { id: { in: [vivo.id, tirado.id] } } });
  }
});

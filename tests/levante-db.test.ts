import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { crearBaseDescartable } from "./helpers/base-descartable";
import { instanteDe, sumarDias } from "../lib/dates";

/**
 * Marcar, desmarcar y leer el levante contra una base de verdad.
 *
 * Las pruebas se encadenan sobre el evento principal (El Carmen, ayer); lo que
 * necesita un estado propio usa un evento aparte (`conEventoAparte`).
 */

const base = crearBaseDescartable("levante-db");
let prisma: typeof import("../lib/db").prisma;
let db: typeof import("../lib/levante-db");
const PABLO = { id: "u-pablo", name: "Pablo" };
const DANTE = { id: "u-dante", name: "Dante" };
// Un martes cualquiera: todo se fecha respecto de este día, no del reloj.
const HOY = "2026-11-10";
const AYER = sumarDias(HOY, -1);
let ids: { periodo: string; evento: string; copa: string; mantel: string; hielo: string; bandeja: string };

before(async () => {
  ({ prisma } = await import("../lib/db"));
  db = await import("../lib/levante-db");
  const periodo = await prisma.operationalPeriod.create({ data: { startDay: sumarDias(HOY, -10), endDay: sumarDias(HOY, 2) } });
  const evento = await prisma.event.create({ data: { periodId: periodo.id, lugar: "El Carmen", date: instanteDe(AYER, "21:00") } });
  const copa = await prisma.product.create({ data: { name: "Copa de agua", category: "ENSERES", type: "REUTILIZABLE", stock: 250 } });
  const mantel = await prisma.product.create({ data: { name: "Mantel redondo", category: "MANTELERIA", type: "REUTILIZABLE", stock: 10 } });
  const hielo = await prisma.product.create({ data: { name: "Hielo", category: "BEBIDA", type: "CONSUMIBLE", stock: 0 } });
  const silla = await prisma.product.create({ data: { name: "Silla", category: "MOBILIARIO", type: "REUTILIZABLE", stock: 100 } });
  await prisma.orderLine.create({ data: { eventId: evento.id, productId: copa.id, qty: 40, note: "las altas" } });
  await prisma.orderLine.create({ data: { eventId: evento.id, productId: mantel.id, qty: 6 } });
  await prisma.orderLine.create({ data: { eventId: evento.id, productId: hielo.id, qty: 20 } });
  // Un renglón en cero no fue al evento.
  await prisma.orderLine.create({ data: { eventId: evento.id, productId: silla.id, qty: 0 } });
  const bandeja = await prisma.orderLine.create({
    data: { eventId: evento.id, customName: "Bandeja plateada", customCategory: "ENSERES", customUnit: "Unidad", qty: 3 },
  });
  ids = { periodo: periodo.id, evento: evento.id, copa: copa.id, mantel: mantel.id, hielo: hielo.id, bandeja: `custom:${bandeja.id}` };
});

after(async () => {
  await prisma?.$disconnect();
  base.borrar();
});

const itemDe = async (clave: string, eventId = ids.evento) => (await db.levanteDelEvento(eventId)).find((i) => i.clave === clave);
const filaDe = (clave: string, eventId = ids.evento) => prisma.levante.findUnique({ where: { eventId_clave: { eventId, clave } } });

/** Un evento aparte, con una copa, para lo que necesita su propio estado. */
async function conEventoAparte(lugar: string, f: (eventId: string) => Promise<void>) {
  const ev = await prisma.event.create({ data: { periodId: ids.periodo, lugar, date: instanteDe(AYER, "20:00") } });
  await prisma.orderLine.create({ data: { eventId: ev.id, productId: ids.copa, qty: 10 } });
  try {
    await f(ev.id);
  } finally {
    await prisma.event.deleteMany({ where: { id: ev.id } });
  }
}

test("la lista es lo reutilizable y lo suelto que se mandó, por sector y sin consumibles", async () => {
  const items = await db.levanteDelEvento(ids.evento);
  assert.deepEqual(
    items.map((i) => [i.itemName, i.category, i.qty, i.estado]),
    [
      ["Bandeja plateada", "ENSERES", 3, "PENDIENTE"],
      ["Copa de agua", "ENSERES", 40, "PENDIENTE"],
      ["Mantel redondo", "MANTELERIA", 6, "PENDIENTE"],
    ],
  );
  assert.equal(items.find((i) => i.clave === ids.copa)?.note, "las altas");
});

test("marcar que volvió todo guarda lo que se mandó y quién", async () => {
  assert.equal(await db.marcarVolvio(ids.evento, ids.copa, PABLO, 40), "marcado");
  const fila = await filaDe(ids.copa);
  assert.deepEqual([fila?.qty, fila?.faltan, fila?.itemName, fila?.category, fila?.porName], [40, 0, "Copa de agua", "ENSERES", "Pablo"]);
  assert.equal((await itemDe(ids.copa))?.estado, "VOLVIO");
});

test("marcar un faltante y corregirlo pisa la misma fila", async () => {
  assert.equal(await db.marcarFalta(ids.evento, ids.mantel, PABLO, 6, 6), "marcado");
  assert.deepEqual([(await itemDe(ids.mantel))?.estado, (await itemDe(ids.mantel))?.faltan], ["FALTA", 6]);
  assert.equal(await db.marcarFalta(ids.evento, ids.mantel, DANTE, 6, 2), "marcado");
  const fila = await filaDe(ids.mantel);
  assert.deepEqual([fila?.faltan, fila?.porName], [2, "Dante"]);
  assert.equal(await prisma.levante.count({ where: { eventId: ids.evento, clave: ids.mantel } }), 1);
});

test("si el pedido cambió entre el dibujo y el toque, no se marca", async () => {
  await conEventoAparte("Toque tarde", async (ev) => {
    // La fila se dibujó con 10; antes del toque alguien lo pasa a 12.
    await prisma.orderLine.updateMany({ where: { eventId: ev, productId: ids.copa }, data: { qty: 12 } });
    assert.equal(await db.marcarVolvio(ev, ids.copa, PABLO, 10), "cambio");
    assert.equal(await db.marcarFalta(ev, ids.copa, PABLO, 10, 2), "cambio");
    assert.equal(await filaDe(ids.copa, ev), null);
  });
});

test("si el pedido cambia después de marcar, el ítem vuelve a estar sin revisar", async () => {
  await conEventoAparte("Cambio después", async (ev) => {
    await db.marcarFalta(ev, ids.copa, PABLO, 10, 3);
    await prisma.orderLine.updateMany({ where: { eventId: ev, productId: ids.copa }, data: { qty: 12 } });
    const i = await itemDe(ids.copa, ev);
    assert.deepEqual([i?.estado, i?.qty, i?.faltan], ["PENDIENTE", 12, 0]);
    // Volver a marcar con lo de ahora pone la fila al día.
    assert.equal(await db.marcarVolvio(ev, ids.copa, PABLO, 12), "marcado");
    assert.deepEqual([(await filaDe(ids.copa, ev))?.qty, (await filaDe(ids.copa, ev))?.faltan], [12, 0]);
  });
});

test("lo que no vuelve o no está en el pedido no se marca", async () => {
  assert.equal(await db.marcarVolvio(ids.evento, ids.hielo, PABLO, 20), "no-existe", "el hielo es consumible");
  assert.equal(await db.marcarVolvio(ids.evento, "no-existe", PABLO, 1), "no-existe");
  assert.equal(await prisma.levante.count({ where: { eventId: ids.evento, clave: { in: [ids.hielo, "no-existe"] } } }), 0);
});

test("desmarcar vuelve a sin revisar, solo si el ítem sigue como se vio", async () => {
  await conEventoAparte("Desmarcar", async (ev) => {
    await db.marcarVolvio(ev, ids.copa, PABLO, 10);
    // Otro teléfono marca un faltante después de que esta pantalla vio "volvió todo".
    await db.marcarFalta(ev, ids.copa, DANTE, 10, 3);
    assert.equal(await db.desmarcar(ev, ids.copa, 0), "cambio", "borró un faltante que nadie vio");
    assert.equal((await itemDe(ids.copa, ev))?.faltan, 3);
    assert.equal(await db.desmarcar(ev, ids.copa, 3), "desmarcado");
    assert.equal((await itemDe(ids.copa, ev))?.estado, "PENDIENTE");
  });
});

test("tachar un sector marca lo pendiente que se vio igual y avisa lo que cambió", async () => {
  await conEventoAparte("Sector", async (ev) => {
    const plato = await prisma.orderLine.create({ data: { eventId: ev, customName: "Plato", customCategory: "ENSERES", qty: 5 } });
    const vistos = [
      { clave: ids.copa, qty: 10 },
      { clave: `custom:${plato.id}`, qty: 5 },
    ];
    // Después de dibujar: el plato sube y entra una servilleta que nadie vio.
    await prisma.orderLine.update({ where: { id: plato.id }, data: { qty: 6 } });
    const servilleta = await prisma.orderLine.create({ data: { eventId: ev, customName: "Servilleta", customCategory: "ENSERES", qty: 30 } });
    assert.deepEqual(await db.marcarSector(ev, "ENSERES", PABLO, vistos), { resultado: "ok", marcados: 1, salteados: 1 });
    assert.equal((await itemDe(ids.copa, ev))?.estado, "VOLVIO");
    assert.equal((await itemDe(`custom:${plato.id}`, ev))?.estado, "PENDIENTE", "se marcó con un número que nadie vio");
    assert.equal((await itemDe(`custom:${servilleta.id}`, ev))?.estado, "PENDIENTE", "se marcó algo que nadie vio");
    // Otro teléfono con la misma pantalla vieja: la copa ya está y no se cuenta de nuevo.
    assert.deepEqual(await db.marcarSector(ev, "ENSERES", PABLO, vistos), { resultado: "ok", marcados: 0, salteados: 1 });
  });
});

test("con el levante terminado o el evento en la papelera no se marca nada", async () => {
  await conEventoAparte("Cerrado", async (ev) => {
    await db.marcarVolvio(ev, ids.copa, PABLO, 10);
    await prisma.event.update({ where: { id: ev }, data: { levanteAt: new Date(), levantePorName: "Pablo" } });
    assert.equal(await db.marcarFalta(ev, ids.copa, PABLO, 10, 1), "cerrado");
    assert.equal(await db.desmarcar(ev, ids.copa, 0), "cerrado");
    assert.deepEqual(await db.marcarSector(ev, "ENSERES", PABLO, [{ clave: ids.copa, qty: 10 }]), { resultado: "cerrado", marcados: 0, salteados: 0 });
    assert.equal((await filaDe(ids.copa, ev))?.faltan, 0, "se cambió una marca de un levante terminado");
    await prisma.event.update({ where: { id: ev }, data: { levanteAt: null, deletedAt: new Date() } });
    assert.equal(await db.marcarFalta(ev, ids.copa, PABLO, 10, 1), "cerrado");
  });
});

test("un faltante ya descontado del stock no se marca ni se desmarca", async () => {
  await conEventoAparte("Descontado", async (ev) => {
    await db.marcarFalta(ev, ids.copa, PABLO, 10, 2);
    await prisma.levante.update({
      where: { eventId_clave: { eventId: ev, clave: ids.copa } },
      data: { descontadoAt: new Date(), descontadoMotivo: "ROTURA", descontadoPorName: "Ana" },
    });
    assert.equal(await db.marcarVolvio(ev, ids.copa, PABLO, 10), "descontado");
    assert.equal(await db.desmarcar(ev, ids.copa, 2), "cambio");
    const i = await itemDe(ids.copa, ev);
    assert.deepEqual([i?.estado, i?.faltan, i?.descontado?.motivo], ["FALTA", 2, "ROTURA"]);
  });
});

test("borrar el evento borra lo marcado", async () => {
  const otro = await prisma.event.create({ data: { periodId: ids.periodo, lugar: "Otro", date: instanteDe(AYER, "20:00") } });
  await prisma.levante.create({ data: { eventId: otro.id, clave: "x", itemName: "X", unit: "Unidad", category: "ENSERES", qty: 1, porName: "Pablo" } });
  await prisma.event.delete({ where: { id: otro.id } });
  assert.equal(await prisma.levante.count({ where: { eventId: otro.id } }), 0);
});

test("para levantar: desde su día hasta 7 días atrás, sin terminar, vivos y con algo que vuelva", async () => {
  const mk = (lugar: string, dia: string, hora: string, extra: { deletedAt?: Date; levanteAt?: Date } = {}) =>
    prisma.event.create({ data: { periodId: ids.periodo, lugar, date: instanteDe(dia, hora), ...extra } });
  const conCopa = async (e: { id: string }) => {
    await prisma.orderLine.create({ data: { eventId: e.id, productId: ids.copa, qty: 10 } });
    return e;
  };
  const creados = [
    await conCopa(await mk("Hoy a la noche", HOY, "23:30")),
    // Los bordes: el día 7 para atrás entra a primera hora; el 8 ya no, aunque sea tarde.
    await conCopa(await mk("Hace 7 días", sumarDias(HOY, -7), "00:30")),
    await conCopa(await mk("Hace 8 días", sumarDias(HOY, -8), "23:30")),
    await conCopa(await mk("Mañana", sumarDias(HOY, 1), "00:30")),
    await conCopa(await mk("Terminado", AYER, "20:00", { levanteAt: new Date() })),
    await conCopa(await mk("Borrado", AYER, "20:00", { deletedAt: new Date() })),
    await mk("Sin pedido", AYER, "20:00"),
  ];
  const soloHielo = await mk("Solo hielo", AYER, "20:00");
  await prisma.orderLine.create({ data: { eventId: soloHielo.id, productId: ids.hielo, qty: 20 } });
  creados.push(soloHielo);
  try {
    const lista = await db.eventosParaLevantar(HOY);
    assert.deepEqual(
      lista.map((e) => e.lugar),
      ["Hoy a la noche", "El Carmen", "Hace 7 días"],
      "el más reciente primero, y solo los que entran",
    );
    const carmen = lista.find((e) => e.lugar === "El Carmen")!;
    // La copa volvió y el mantel tiene un faltante: 2 de 3 revisados.
    assert.deepEqual([carmen.marcados, carmen.total, carmen.dia], [2, 3, AYER]);
  } finally {
    await prisma.event.deleteMany({ where: { id: { in: creados.map((e) => e.id) } } });
  }
});

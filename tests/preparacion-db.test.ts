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

test("tildar guarda lo que se vio y lo deja preparado", async () => {
  assert.equal(await db.tildar(ids.evento, ids.copa, PABLO, { estado: "PENDIENTE", qty: 300, note: "las altas" }), "tildado");
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
  await db.tildar(ids.evento, ids.copa, { id: "u-ana", name: "Ana" }, { estado: "CAMBIO", qty: 314, note: "las bajas" });
  assert.equal((await estadoDe(ids.copa))?.estado, "PREPARADO");
  // Volver a tildar guarda la cantidad Y la nota que se vieron, y quién lo hizo.
  const fila = await prisma.preparacion.findUnique({ where: { eventId_clave: { eventId: ids.evento, clave: ids.copa } } });
  assert.deepEqual([fila?.qty, fila?.note, fila?.porName], [314, "las bajas", "Ana"]);
});

test("si el renglón se borra, lo tildado pide sacarlo; tildarlo de nuevo lo da por sacado", async () => {
  await db.tildar(ids.evento, ids.mesa, PABLO, { estado: "PENDIENTE", qty: 12, note: null });
  await prisma.orderLine.deleteMany({ where: { eventId: ids.evento, productId: ids.mesa } });
  assert.equal((await estadoDe(ids.mesa))?.estado, "SACAR");
  assert.equal(await db.tildar(ids.evento, ids.mesa, PABLO, { estado: "SACAR", qty: 0, note: null }), "sacado");
  assert.equal(await estadoDe(ids.mesa), undefined);
});

test("tildar algo que no está ni tildado ni en el pedido no hace nada", async () => {
  assert.equal(await db.tildar(ids.evento, "no-existe", PABLO, { estado: "PENDIENTE", qty: 1, note: null }), "no-existe");
  assert.equal(await db.tildar(ids.evento, "no-existe", PABLO, { estado: "SACAR", qty: 0, note: null }), "no-existe");
  assert.equal(await prisma.preparacion.count({ where: { eventId: ids.evento, clave: "no-existe" } }), 0);
});

test("destildar borra la fila: es para errores de quien tilda", async () => {
  const visto = { estado: "PREPARADO" as const, qty: 314, note: "las bajas" };
  assert.equal(await db.destildar(ids.evento, ids.copa, visto), "destildado");
  assert.equal((await estadoDe(ids.copa))?.estado, "PENDIENTE");
  // Ya no está preparado: un segundo toque con la pantalla vieja no hace nada.
  assert.equal(await db.destildar(ids.evento, ids.copa, visto), "cambio");
});

test("tildar un sector toma solo lo pendiente de ese sector, como se vio", async () => {
  await db.tildar(ids.evento, ids.suelto, PABLO, { estado: "PENDIENTE", qty: 20, note: null });
  await prisma.orderLine.updateMany({ where: { eventId: ids.evento, customName: "Hielo" }, data: { qty: 25 } });
  // Aunque el Hielo llegue en lo visto, cambió: se confirma de a uno.
  assert.deepEqual(
    await db.tildarSector(ids.evento, "BEBIDA", PABLO, [{ clave: ids.suelto, qty: 25, note: null }]),
    { tildados: 0, salteados: 1 },
  );
  assert.deepEqual(
    await db.tildarSector(ids.evento, "ENSERES", PABLO, [{ clave: ids.copa, qty: 314, note: "las bajas" }]),
    { tildados: 1, salteados: 0 },
  );
  assert.equal((await estadoDe(ids.copa))?.estado, "PREPARADO");
  assert.equal((await estadoDe(ids.suelto))?.estado, "CAMBIO");
});

/** Un evento aparte para lo que pasa entre que se dibuja la pantalla y el
 *  toque: las pruebas de arriba encadenan el estado del evento principal. */
async function conEventoAparte(lugar: string, f: (eventId: string) => Promise<void>) {
  const ev = await prisma.event.create({ data: { periodId: ids.periodo, lugar, date: instanteDe(hoy(), "21:00") } });
  try {
    await f(ev.id);
  } finally {
    await prisma.event.deleteMany({ where: { id: ev.id } });
  }
}
const estadoEn = async (eventId: string, clave: string) => (await db.estadoDelEvento(eventId)).find((i) => i.clave === clave);
const filaDe = (eventId: string, clave: string) => prisma.preparacion.findUnique({ where: { eventId_clave: { eventId, clave } } });

test("si el pedido cambia entre que se dibujó la fila y el toque, se guarda lo que se vio y el cambio queda a la vista", async () => {
  await conEventoAparte("Toque tarde", async (ev) => {
    await prisma.orderLine.create({ data: { eventId: ev, productId: ids.copa, qty: 10, note: "las altas" } });
    // La fila se dibujó con 10; antes del toque alguien lo pasa a 24.
    await prisma.orderLine.updateMany({ where: { eventId: ev, productId: ids.copa }, data: { qty: 24 } });
    assert.equal(await db.tildar(ev, ids.copa, PABLO, { estado: "PENDIENTE", qty: 10, note: "las altas" }), "tildado");
    const i = await estadoEn(ev, ids.copa);
    assert.equal(i?.estado, "CAMBIO", "quedó preparado con un número que nadie vio");
    assert.equal(i?.accion, "Sumá 14");
    assert.equal(i?.tildado?.qty, 10);

    // Lo mismo con la nota: se vio "las altas", el pedido ya dice "las bajas".
    await prisma.orderLine.updateMany({ where: { eventId: ev, productId: ids.copa }, data: { note: "las bajas" } });
    await db.tildar(ev, ids.copa, PABLO, { estado: "CAMBIO", qty: 24, note: "las altas" });
    assert.equal((await estadoEn(ev, ids.copa))?.estado, "NOTA");
  });
});

test("si el renglón se borra entre el dibujo y el toque, lo tildado guarda lo visto y pide sacarlo", async () => {
  await conEventoAparte("Borrado tarde", async (ev) => {
    await prisma.orderLine.create({ data: { eventId: ev, productId: ids.copa, qty: 10 } });
    await db.tildar(ev, ids.copa, PABLO, { estado: "PENDIENTE", qty: 10, note: null });
    await prisma.orderLine.updateMany({ where: { eventId: ev, productId: ids.copa }, data: { qty: 24 } });
    // Se vio "Sumá 14" y se confirma, pero mientras tanto sacaron el ítem del pedido.
    await prisma.orderLine.deleteMany({ where: { eventId: ev, productId: ids.copa } });
    assert.equal(await db.tildar(ev, ids.copa, PABLO, { estado: "CAMBIO", qty: 24, note: null }), "tildado");
    const i = await estadoEn(ev, ids.copa);
    assert.equal(i?.estado, "SACAR", "tenía que quedar en 'Cambios para aplicar'");
    assert.equal(i?.accion, "Sacá 24 · ya no va");
    assert.equal((await filaDe(ev, ids.copa))?.porName, "Pablo");
  });
});

test("confirmar algo visto para sacar borra la fila, aunque el ítem haya vuelto al pedido", async () => {
  await conEventoAparte("Volvió", async (ev) => {
    await prisma.orderLine.create({ data: { eventId: ev, productId: ids.copa, qty: 10 } });
    await db.tildar(ev, ids.copa, PABLO, { estado: "PENDIENTE", qty: 10, note: null });
    await prisma.orderLine.deleteMany({ where: { eventId: ev, productId: ids.copa } });
    assert.equal((await estadoEn(ev, ids.copa))?.estado, "SACAR");
    // Se vio "Sacá 10 · ya no va"; antes del toque lo vuelven a pedir.
    await prisma.orderLine.create({ data: { eventId: ev, productId: ids.copa, qty: 10 } });
    assert.equal(await db.tildar(ev, ids.copa, PABLO, { estado: "SACAR", qty: 0, note: null }), "sacado");
    // Se sacó de verdad: lo que vuelve a pedirse está por preparar.
    assert.equal((await estadoEn(ev, ids.copa))?.estado, "PENDIENTE");
  });
});

test("destildar un ✓ viejo no toca nada si el ítem cambió desde que se vio", async () => {
  await conEventoAparte("Tilde viejo", async (ev) => {
    await prisma.orderLine.create({ data: { eventId: ev, productId: ids.copa, qty: 10 } });
    await db.tildar(ev, ids.copa, PABLO, { estado: "PENDIENTE", qty: 10, note: null });
    const visto = { estado: "PREPARADO" as const, qty: 10, note: null };
    await prisma.orderLine.updateMany({ where: { eventId: ev, productId: ids.copa }, data: { qty: 24 } });
    assert.equal(await db.destildar(ev, ids.copa, visto), "cambio");
    assert.equal((await estadoEn(ev, ids.copa))?.accion, "Sumá 14", "se borró la instrucción");
    // Solo la nota también cuenta.
    await prisma.orderLine.updateMany({ where: { eventId: ev, productId: ids.copa }, data: { qty: 10, note: "las altas" } });
    assert.equal(await db.destildar(ev, ids.copa, visto), "cambio");
    assert.equal((await estadoEn(ev, ids.copa))?.estado, "NOTA");
    // Con el pedido otra vez como se vio, sí destilda.
    await prisma.orderLine.updateMany({ where: { eventId: ev, productId: ids.copa }, data: { note: null } });
    assert.equal(await db.destildar(ev, ids.copa, visto), "destildado");
    assert.equal(await filaDe(ev, ids.copa), null);
  });
});

test("tildar un sector no tilda lo que entró ni lo que cambió después de dibujar la pantalla", async () => {
  await conEventoAparte("Sector tarde", async (ev) => {
    await prisma.orderLine.create({ data: { eventId: ev, productId: ids.copa, qty: 10 } });
    const plato = await prisma.orderLine.create({
      data: { eventId: ev, customName: "Plato", customCategory: "ENSERES", qty: 5 },
    });
    const vistos = [
      { clave: ids.copa, qty: 10, note: null },
      { clave: `custom:${plato.id}`, qty: 5, note: null },
    ];
    // Después de dibujar: la copa sube y entra una servilleta que nadie vio.
    await prisma.orderLine.updateMany({ where: { eventId: ev, productId: ids.copa }, data: { qty: 12 } });
    const servilleta = await prisma.orderLine.create({
      data: { eventId: ev, customName: "Servilleta", customCategory: "ENSERES", qty: 30 },
    });
    assert.deepEqual(await db.tildarSector(ev, "ENSERES", PABLO, vistos), { tildados: 1, salteados: 1 });
    assert.equal((await estadoEn(ev, `custom:${plato.id}`))?.estado, "PREPARADO");
    assert.equal((await estadoEn(ev, ids.copa))?.estado, "PENDIENTE", "se tildó con un número que nadie vio");
    assert.equal((await estadoEn(ev, `custom:${servilleta.id}`))?.estado, "PENDIENTE", "se tildó algo que nadie vio");
    // Otra vez lo mismo (otro teléfono con la pantalla vieja): el plato ya está
    // y no se cuenta de nuevo; la copa sigue cambiada.
    assert.deepEqual(await db.tildarSector(ev, "ENSERES", PABLO, vistos), { tildados: 0, salteados: 1 });
  });
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

test("la tarjeta de cada evento dice qué rehacer y quién lo cambió por última vez", async () => {
  const quieto = await prisma.event.create({
    data: { periodId: ids.periodo, lugar: "Sin cambios", date: instanteDe(sumarDias(hoy(), 2), "21:00") },
  });
  const cambio = (actorName: string, hace: number) =>
    prisma.orderChange.create({
      data: { eventId: ids.evento, actorName, itemName: "Hielo", kind: "CANTIDAD", before: "20", after: "25", createdAt: new Date(Date.now() - hace) },
    });
  const viejo = await cambio("Aldana", 3_600_000);
  const nuevo = await cambio("Enrique", 60_000);
  try {
    const lista = await db.eventosParaPreparar();
    const carmen = lista.find((e) => e.lugar === "El Carmen")!;
    // Las mismas acciones que el aviso al teléfono, una por cada cambio para aplicar.
    assert.equal(carmen.acciones.length, carmen.cambiosParaAplicar);
    assert.match(carmen.acciones[0], /Hielo/);
    // El último, no el primero.
    assert.equal(carmen.ultimoCambio?.actorName, "Enrique");
    assert.equal(carmen.ultimoCambio?.at.getTime(), nuevo.createdAt.getTime());
    const sinCambios = lista.find((e) => e.lugar === "Sin cambios")!;
    assert.equal(sinCambios.ultimoCambio, null);
    assert.deepEqual(sinCambios.acciones, []);
  } finally {
    await prisma.orderChange.deleteMany({ where: { id: { in: [viejo.id, nuevo.id] } } });
    await prisma.event.delete({ where: { id: quieto.id } });
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

test("restaurar una versión no deja en SACAR lo tildado de un suelto que sigue yendo", async () => {
  // Restaurar borra los renglones y los crea de nuevo: cada suelto vuelve con
  // otro id, y su clave es el id. Sin reasignar, lo tildado quedaba en SACAR
  // ("Sacá 3 Mantel bordó") aunque el mantel siguiera yendo.
  // Un período propio: restaurar recrea los renglones de TODO el período.
  const snapshot = await import("../lib/snapshot");
  const periodo = await prisma.operationalPeriod.create({ data: { startDay: hoy(), endDay: hoy() } });
  const ev = await prisma.event.create({ data: { periodId: periodo.id, lugar: "Restaurado", date: instanteDe(hoy(), "21:00") } });
  const otro = await prisma.event.create({ data: { periodId: periodo.id, lugar: "Otro del período", date: instanteDe(hoy(), "22:00") } });
  try {
    const suelto = (eventId: string, customName: string, customCategory: string, customUnit: string, qty: number, note: string | null = null) =>
      prisma.orderLine.create({ data: { eventId, customName, customCategory, customUnit, qty, note } });
    // Dos manteles con el mismo nombre: cada fila tildada vuelve a su renglón.
    const mantel = await suelto(ev.id, "Mantel bordó", "MANTELERIA", "Unidad", 3);
    const mantelLargo = await suelto(ev.id, "Mantel bordó", "MANTELERIA", "Unidad", 2, "los largos");
    const hielo = await suelto(ev.id, "Hielo", "BEBIDA", "Bolsa", 20);
    // Otro evento con el mismo suelto: lo de un evento no se pasa a otro.
    await suelto(otro.id, "Hielo", "BEBIDA", "Bolsa", 20);
    for (const l of [mantel, mantelLargo, hielo]) {
      await db.tildar(ev.id, `custom:${l.id}`, PABLO, { estado: "PENDIENTE", qty: l.qty, note: l.note });
    }

    // La versión que se restaura no tiene el hielo de este evento: ese sí se va.
    const { data } = await snapshot.buildSnapshotData(periodo.id);
    const sinHielo = (JSON.parse(data) as { eventId: string; customName: string | null }[]).filter(
      (l) => !(l.eventId === ev.id && l.customName === "Hielo"),
    );
    await snapshot.applySnapshotData(periodo.id, JSON.stringify(sinHielo));
    assert.equal(
      (await db.estadoDelEvento(ev.id)).filter((i) => i.estado === "SACAR").length,
      3,
      "la prueba no reproduce el problema: los sueltos no cambiaron de id",
    );

    assert.equal(await db.reasignarSueltos(periodo.id), 2);
    const items = await db.estadoDelEvento(ev.id);
    const manteles = items.filter((i) => i.itemName === "Mantel bordó");
    assert.deepEqual(
      manteles.map((i) => [i.estado, i.qty, i.note]).sort(),
      [["PREPARADO", 2, "los largos"], ["PREPARADO", 3, null]].sort(),
      "un mantel tildado quedó en SACAR o en el renglón del otro",
    );
    assert.ok(manteles.every((i) => i.tildado?.porName === "Pablo"), "se perdió quién lo tildó");
    // El hielo de este evento ya no va: sigue pidiendo que lo saquen.
    assert.deepEqual(items.filter((i) => i.itemName === "Hielo").map((i) => i.estado), ["SACAR"]);
    assert.equal(await prisma.preparacion.count({ where: { eventId: otro.id } }), 0);
    // Una segunda vez no hay nada que reasignar.
    assert.equal(await db.reasignarSueltos(periodo.id), 0);
  } finally {
    await prisma.event.deleteMany({ where: { id: { in: [ev.id, otro.id] } } });
    await prisma.operationalPeriod.delete({ where: { id: periodo.id } });
  }
});

test("reasignar los sueltos nunca lanza: la restauración ya se hizo", async () => {
  const original = prisma.event.findMany;
  const consoleError = console.error;
  const errores: string[] = [];
  prisma.event.findMany = (async () => {
    throw new Error("database is locked");
  }) as unknown as typeof prisma.event.findMany;
  console.error = (...args: unknown[]) => void errores.push(args.map(String).join(" "));
  try {
    assert.equal(await db.reasignarSueltos(ids.periodo), 0);
  } finally {
    prisma.event.findMany = original;
    console.error = consoleError;
  }
  assert.ok(errores.some((x) => x.includes("[avisos]") && x.includes("database is locked")), errores.join("\n"));
});

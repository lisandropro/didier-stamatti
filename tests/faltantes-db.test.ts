import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { crearBaseDescartable } from "./helpers/base-descartable";
import { diaDe, instanteDe, sumarDias } from "../lib/dates";

/**
 * El barrido de faltantes contra una base de verdad: la primera corrida no
 * avisa, un faltante nuevo avisa una vez, empeorar avisa otra vez, resolverse
 * no avisa, y la regla es la misma que la del editor.
 */

const base = crearBaseDescartable("faltantes-db");
let prisma: typeof import("../lib/db").prisma;
let barrer: typeof import("../lib/faltantes-db").barrerFaltantes;
const enviados: { title: string; body: string; url?: string; tag?: string; endpoint: string }[] = [];
let ids: { periodo: string; evento: string; ana: string; pablo: string; dante: string; enrique: string; copa: string; mesa: string };

// "Ahora" fijo: el período y el evento son de hoy, y los cambios se fechan
// respecto de este instante para no depender del reloj.
const ahora = new Date();
const hoyDia = diaDe(ahora);
const haceMin = (min: number) => new Date(ahora.getTime() - min * 60_000);

before(async () => {
  ({ prisma } = await import("../lib/db"));
  ({ barrerFaltantes: barrer } = await import("../lib/faltantes-db"));
  const push = await import("../lib/push");
  push.transporte.listo = () => true;
  push.transporte.enviar = async (destino, cuerpo) => {
    enviados.push({ ...JSON.parse(cuerpo), endpoint: destino.endpoint });
    return { statusCode: 201 };
  };
  const mk = (name: string, role: string) =>
    prisma.user.create({ data: { name, email: `${name.toLowerCase()}@test.local`, role, passwordHash: "x" } });
  const ana = await mk("Ana", "ADMIN");
  const pablo = await mk("Pablo", "LOGISTICA");
  const dante = await mk("Dante", "DEPOSITO");
  const enrique = await mk("Enrique", "ARMADOR");
  for (const u of [pablo, dante]) {
    await prisma.pushSubscription.create({ data: { userId: u.id, endpoint: `https://fcm.googleapis.com/fcm/send/${u.name}`, p256dh: "k", auth: "a" } });
  }
  const periodo = await prisma.operationalPeriod.create({ data: { label: "Finde", startDay: hoyDia, endDay: sumarDias(hoyDia, 2) } });
  const evento = await prisma.event.create({ data: { periodId: periodo.id, lugar: "El Carmen", date: instanteDe(hoyDia, "21:00") } });
  const copa = await prisma.product.create({ data: { name: "Copa de agua", category: "ENSERES", type: "REUTILIZABLE", stock: 250 } });
  const mesa = await prisma.product.create({ data: { name: "Mesa", category: "MOBILIARIO", type: "REUTILIZABLE", stock: 10 } });
  await prisma.orderLine.create({ data: { eventId: evento.id, productId: copa.id, qty: 300 } });
  ids = { periodo: periodo.id, evento: evento.id, ana: ana.id, pablo: pablo.id, dante: dante.id, enrique: enrique.id, copa: copa.id, mesa: mesa.id };
});

after(async () => {
  await prisma?.$disconnect();
  base.borrar();
});

const filas = () => prisma.faltanteAvisado.findMany({ where: { periodId: ids.periodo }, orderBy: { productId: "asc" } });
const cambio = (itemName: string, createdAt: Date) =>
  prisma.orderChange.create({ data: { eventId: ids.evento, actorName: "Enrique", itemName, kind: "CANTIDAD", createdAt } });

test("la primera corrida registra lo que ya falta sin avisar", async () => {
  const r = await barrer(ahora);
  assert.equal(r.avisos, 0);
  assert.equal(r.registrados, 1);
  assert.deepEqual((await filas()).map((f) => [f.productId, f.missing]), [[ids.copa, 50]]);
  assert.ok((await prisma.operationalPeriod.findUnique({ where: { id: ids.periodo } }))?.faltantesDesde);
  assert.equal(enviados.length, 0);
});

test("un faltante nuevo avisa una vez, a todos, con prioridad y con su causa", async () => {
  await prisma.orderLine.create({ data: { eventId: ids.evento, productId: ids.mesa, qty: 12 } });
  await cambio("Mesa", haceMin(5));
  const r = await barrer(ahora);
  assert.equal(r.avisos, 4, "uno por persona: nadie queda afuera, ni quien hizo el cambio");
  assert.equal(enviados.length, 2, "Pablo y Dante tienen teléfono");
  for (const p of enviados) {
    assert.equal(p.title, "Falta stock · Finde");
    assert.equal(p.body, "Mesa: faltan 2 (piden 12, hay 10). Lo empujó el pedido de El Carmen.");
    assert.equal(p.tag, `faltante-${ids.periodo}`);
  }
  const deDante = enviados.find((p) => p.endpoint.endsWith("Dante"))!;
  const dePablo = enviados.find((p) => p.endpoint.endsWith("Pablo"))!;
  assert.equal(deDante.url, `/preparar/${ids.evento}#faltantes`, "el depósito va a los faltantes de Preparar");
  assert.equal(dePablo.url, `/?w=${ids.periodo}`, "quien ve el stock va a la portada del período");
  const entregas = await prisma.pushDelivery.findMany({ where: { kind: "FALTANTE" } });
  assert.ok(entregas.length === 2 && entregas.every((e) => e.urgency === "high"));
  const avisos = await prisma.notification.findMany({ where: { type: "FALTANTE" } });
  assert.equal(avisos.length, 4);
  assert.ok(avisos.every((a) => a.pushedAt !== null && a.message === "Falta stock en Finde: Mesa (faltan 2)"));

  enviados.length = 0;
  assert.equal((await barrer(ahora)).avisos, 0, "el mismo faltante no se avisa dos veces");
  assert.equal(enviados.length, 0);
});

test("empeorar avisa otra vez; mejorar no avisa ni baja lo guardado", async () => {
  enviados.length = 0;
  await prisma.orderLine.updateMany({ where: { eventId: ids.evento, productId: ids.copa }, data: { qty: 320 } });
  await cambio("Copa de agua", haceMin(5));
  assert.equal((await barrer(ahora)).avisos, 4);
  assert.match(enviados[0].body, /^Copa de agua: faltan 70 \(piden 320, hay 250\)/);

  enviados.length = 0;
  await prisma.orderLine.updateMany({ where: { eventId: ids.evento, productId: ids.copa }, data: { qty: 310 } });
  assert.equal((await barrer(ahora)).avisos, 0);
  assert.equal((await filas()).find((f) => f.productId === ids.copa)?.missing, 70);
});

test("resolverse no avisa y borra la fila", async () => {
  enviados.length = 0;
  await prisma.orderLine.updateMany({ where: { eventId: ids.evento, productId: ids.mesa }, data: { qty: 10 } });
  assert.equal((await barrer(ahora)).avisos, 0);
  assert.equal((await filas()).some((f) => f.productId === ids.mesa), false);
  assert.equal(enviados.length, 0);
});

test("mientras alguien sigue cambiando pedidos del período, el barrido espera", async () => {
  enviados.length = 0;
  await prisma.orderLine.updateMany({ where: { eventId: ids.evento, productId: ids.copa }, data: { qty: 330 } });
  const reciente = await cambio("Copa de agua", haceMin(0.5));
  assert.equal((await barrer(ahora)).avisos, 0, "hace 30 segundos que se cambió: todavía no");
  await prisma.orderChange.update({ where: { id: reciente.id }, data: { createdAt: haceMin(3) } });
  assert.equal((await barrer(ahora)).avisos, 4, "pasada la quietud, sale");
});

test("sin un cambio de pedido reciente, la causa es un ajuste de stock", async () => {
  enviados.length = 0;
  await prisma.orderChange.updateMany({ data: { createdAt: haceMin(120) } });
  await prisma.product.update({ where: { id: ids.copa }, data: { stock: 200 } });
  assert.equal((await barrer(ahora)).avisos, 4);
  assert.match(enviados[0].body, /Copa de agua: faltan 130 \(piden 330, hay 200\)\. Por un ajuste de stock\.$/);
  const deDante = enviados.find((p) => p.endpoint.endsWith("Dante"))!;
  assert.equal(deDante.url, `/preparar/${ids.evento}#faltantes`, "sin causa, el primer evento del período");
});

test("la regla es la del editor: un consumible o un producto sin contar no avisan", async () => {
  enviados.length = 0;
  const vaso = await prisma.product.create({ data: { name: "Vaso descartable", category: "ENSERES", type: "CONSUMIBLE", stock: 1 } });
  const plato = await prisma.product.create({ data: { name: "Plato", category: "ENSERES", type: "REUTILIZABLE", stock: null } });
  await prisma.orderLine.create({ data: { eventId: ids.evento, productId: vaso.id, qty: 1000 } });
  await prisma.orderLine.create({ data: { eventId: ids.evento, productId: plato.id, qty: 50 } });
  assert.equal((await barrer(ahora)).avisos, 0);
  assert.equal((await filas()).some((f) => f.productId === vaso.id || f.productId === plato.id), false);
});

test("un período que ya terminó no se barre", async () => {
  enviados.length = 0;
  const viejo = await prisma.operationalPeriod.create({
    data: { label: "Viejo", startDay: sumarDias(hoyDia, -5), endDay: sumarDias(hoyDia, -3), faltantesDesde: haceMin(9999) },
  });
  const ev = await prisma.event.create({ data: { periodId: viejo.id, lugar: "Pasado", date: instanteDe(sumarDias(hoyDia, -4), "21:00") } });
  await prisma.orderLine.create({ data: { eventId: ev.id, productId: ids.mesa, qty: 500 } });
  await barrer(ahora);
  assert.equal(await prisma.faltanteAvisado.count({ where: { periodId: viejo.id } }), 0);
  assert.equal(enviados.length, 0);
});

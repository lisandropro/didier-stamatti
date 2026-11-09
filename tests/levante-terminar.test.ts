import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { crearBaseDescartable } from "./helpers/base-descartable";
import { instanteDe, sumarDias } from "../lib/dates";

/**
 * Terminar el levante contra una base de verdad: la confirmación con el número
 * de ahora, el aviso a quien toca el stock (una sola vez aunque toquen dos
 * teléfonos) y reabrir.
 */

const base = crearBaseDescartable("levante-terminar");
let prisma: typeof import("../lib/db").prisma;
let db: typeof import("../lib/levante-db");
const enviados: { title: string; body: string; url?: string; tag?: string; endpoint: string }[] = [];
const HOY = "2026-11-10";
const AYER = sumarDias(HOY, -1);
let ids: { periodo: string; copa: string; mantel: string; ana: string; pablo: string; dante: string; enrique: string };
let pablo: { id: string; name: string };
let ana: { id: string; name: string };

before(async () => {
  ({ prisma } = await import("../lib/db"));
  db = await import("../lib/levante-db");
  const push = await import("../lib/push");
  push.transporte.listo = () => true;
  push.transporte.enviar = async (destino, cuerpo) => {
    enviados.push({ ...JSON.parse(cuerpo), endpoint: destino.endpoint });
    return { statusCode: 201 };
  };
  const mk = (name: string, role: string) =>
    prisma.user.create({ data: { name, email: `${name.toLowerCase()}@test.local`, role, passwordHash: "x" } });
  const uAna = await mk("Ana", "ADMIN");
  const uPablo = await mk("Pablo", "LOGISTICA");
  const uDante = await mk("Dante", "DEPOSITO");
  const uEnrique = await mk("Enrique", "ARMADOR");
  for (const u of [uAna, uPablo, uDante, uEnrique]) {
    await prisma.pushSubscription.create({ data: { userId: u.id, endpoint: `https://fcm.googleapis.com/fcm/send/${u.name}`, p256dh: "k", auth: "a" } });
  }
  const periodo = await prisma.operationalPeriod.create({ data: { startDay: sumarDias(HOY, -3), endDay: HOY } });
  const copa = await prisma.product.create({ data: { name: "Copa vino", category: "ENSERES", type: "REUTILIZABLE", stock: 250 } });
  const mantel = await prisma.product.create({ data: { name: "Mantel redondo", category: "MANTELERIA", type: "REUTILIZABLE", stock: 10 } });
  ids = { periodo: periodo.id, copa: copa.id, mantel: mantel.id, ana: uAna.id, pablo: uPablo.id, dante: uDante.id, enrique: uEnrique.id };
  pablo = { id: uPablo.id, name: "Pablo" };
  ana = { id: uAna.id, name: "Ana" };
});

after(async () => {
  await prisma?.$disconnect();
  base.borrar();
});

/** Un evento de ayer con 40 copas y 6 manteles. */
async function evento(lugar: string): Promise<string> {
  const ev = await prisma.event.create({ data: { periodId: ids.periodo, lugar, date: instanteDe(AYER, "21:00") } });
  await prisma.orderLine.create({ data: { eventId: ev.id, productId: ids.copa, qty: 40 } });
  await prisma.orderLine.create({ data: { eventId: ev.id, productId: ids.mantel, qty: 6 } });
  return ev.id;
}
const avisosDe = (eventId: string) => prisma.notification.findMany({ where: { eventId, type: "LEVANTE" } });

test("si cambió cuántos quedan sin revisar, no termina: vuelve el número de ahora", async () => {
  const ev = await evento("Confirmar");
  await db.marcarVolvio(ev, ids.copa, pablo, 40);
  // La pantalla preguntó "Quedan 2 sin revisar", pero mientras tanto se marcó la copa.
  assert.deepEqual(await db.terminarLevante(ev, pablo, 2), { r: "confirmar", sinRevisar: 1 });
  const e = await prisma.event.findUniqueOrThrow({ where: { id: ev } });
  assert.equal(e.levanteAt, null);
  assert.equal((await avisosDe(ev)).length, 0);
});

test("si mientras tanto se revisó todo, termina sin volver a preguntar", async () => {
  const ev = await evento("Ya revisado");
  // La pantalla preguntó "Quedan 2 sin revisar"; otro teléfono marcó las dos.
  await db.marcarVolvio(ev, ids.copa, pablo, 40);
  await db.marcarVolvio(ev, ids.mantel, pablo, 6);
  assert.deepEqual(await db.terminarLevante(ev, pablo, 2), { r: "terminado", avisados: 1 });
  const e = await prisma.event.findUniqueOrThrow({ where: { id: ev } });
  assert.ok(e.levanteAt, "no quedó terminado");
});

test("un evento sin nada que vuelva no se termina ni avisa", async () => {
  const ev = await prisma.event.create({ data: { periodId: ids.periodo, lugar: "Sin nada", date: instanteDe(AYER, "21:00") } });
  assert.deepEqual(await db.terminarLevante(ev.id, pablo, 0), { r: "vacio" });
  const e = await prisma.event.findUniqueOrThrow({ where: { id: ev.id } });
  assert.equal(e.levanteAt, null);
  assert.equal((await avisosDe(ev.id)).length, 0);
});

test("terminar marca el evento y le avisa a quien toca el stock, con lo que faltó", async () => {
  const ev = await evento("MUSEO");
  await db.marcarFalta(ev, ids.copa, pablo, 40, 5);
  await db.marcarFalta(ev, ids.mantel, pablo, 6, 2);
  const antes = enviados.length;
  assert.deepEqual(await db.terminarLevante(ev, pablo, 0), { r: "terminado", avisados: 1 });

  const e = await prisma.event.findUniqueOrThrow({ where: { id: ev } });
  assert.ok(e.levanteAt, "el evento no quedó terminado");
  assert.deepEqual([e.levantePorId, e.levantePorName], [ids.pablo, "Pablo"]);

  // Solo la administradora: ni quien lo terminó, ni el depósito, ni quien arma pedidos.
  const avisos = await avisosDe(ev);
  assert.deepEqual(avisos.map((a) => a.recipientId), [ids.ana]);
  assert.equal(avisos[0].message, "Levante de MUSEO: faltaron 5 Copa vino y 2 Mantel redondo");
  assert.equal(avisos[0].linkUrl, `/preparar/${ev}/levante`);
  assert.equal(avisos[0].actorName, "Pablo");
  assert.ok(avisos[0].pushedAt, "nace marcado como enviado");

  const pushes = enviados.slice(antes);
  assert.equal(pushes.length, 1);
  assert.ok(pushes[0].endpoint.endsWith("Ana"));
  assert.equal(pushes[0].title, "Levante de MUSEO");
  assert.equal(pushes[0].body, "Faltaron 5 Copa vino y 2 Mantel redondo\n— Pablo");
  assert.equal(pushes[0].url, `/preparar/${ev}/levante`);
  assert.equal(pushes[0].tag, `levante-${ev}`);
  const entregas = await prisma.pushDelivery.findMany({ where: { notificationId: avisos[0].id } });
  assert.deepEqual(entregas.map((x) => x.kind), ["LEVANTE"]);
});

test("terminar con pendientes confirmados los deja sin revisar, no como faltantes", async () => {
  const ev = await evento("Con pendientes");
  await db.marcarVolvio(ev, ids.copa, pablo, 40);
  assert.equal((await db.terminarLevante(ev, pablo, 1)).r, "terminado");
  const [aviso] = await avisosDe(ev);
  assert.equal(aviso.message, "Levante de Con pendientes: volvió todo lo revisado · 1 sin revisar");
  assert.equal(await prisma.levante.count({ where: { eventId: ev, clave: ids.mantel } }), 0);
});

test("terminado, no se puede volver a terminar ni marcar", async () => {
  const ev = await evento("Dos veces");
  await db.marcarVolvio(ev, ids.copa, pablo, 40);
  await db.marcarVolvio(ev, ids.mantel, pablo, 6);
  assert.equal((await db.terminarLevante(ev, pablo, 0)).r, "terminado");
  assert.deepEqual(await db.terminarLevante(ev, pablo, 0), { r: "ya" });
  assert.equal(await db.marcarFalta(ev, ids.copa, pablo, 40, 1), "cerrado");
  const avisos = await avisosDe(ev);
  assert.equal(avisos.length, 1, "avisó dos veces");
  assert.equal(avisos[0].message, "Levante de Dos veces: volvió todo");
});

test("dos teléfonos terminan a la vez: termina y avisa uno solo", async () => {
  const ev = await evento("A la vez");
  const [x, y] = await Promise.all([db.terminarLevante(ev, pablo, 2), db.terminarLevante(ev, pablo, 2)]);
  assert.deepEqual([x.r, y.r].sort(), ["terminado", "ya"]);
  assert.equal((await avisosDe(ev)).length, 1);
});

test("si la administradora lo termina, no se avisa a sí misma", async () => {
  const ev = await evento("Lo termina Ana");
  assert.deepEqual(await db.terminarLevante(ev, ana, 2), { r: "terminado", avisados: 0 });
  assert.equal((await avisosDe(ev)).length, 0);
});

test("un evento en la papelera no se termina", async () => {
  const ev = await evento("Borrado");
  await prisma.event.update({ where: { id: ev }, data: { deletedAt: new Date() } });
  assert.deepEqual(await db.terminarLevante(ev, pablo, 2), { r: "no-existe" });
});

test("reabrir deja marcar de nuevo y el evento vuelve a Para levantar", async () => {
  const ev = await evento("Reabrir");
  await db.terminarLevante(ev, pablo, 2);
  assert.ok(!(await db.eventosParaLevantar(HOY)).some((e) => e.id === ev), "un terminado sigue en Para levantar");
  assert.equal(await db.reabrirLevante(ev), "reabierto");
  assert.equal(await db.reabrirLevante(ev), "ya");
  const e = await prisma.event.findUniqueOrThrow({ where: { id: ev } });
  assert.deepEqual([e.levanteAt, e.levantePorId, e.levantePorName], [null, null, null]);
  assert.equal(await db.marcarVolvio(ev, ids.copa, pablo, 40), "marcado");
  assert.ok((await db.eventosParaLevantar(HOY)).some((x) => x.id === ev));
  assert.equal(await db.reabrirLevante("no-existe"), "no-existe");
});

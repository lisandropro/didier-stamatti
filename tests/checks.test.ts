import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { instanteDe, hoy, sumarDias } from "../lib/dates";

/**
 * Los controles de datos: señalan incoherencias, no las corrigen.
 *
 * Se prueban contra una base de verdad porque cada uno nació de un caso real
 * encontrado auditando producción, y lo que hay que fijar es que **detecten ese
 * caso** — un control que no encuentra el problema que motivó su existencia es
 * peor que no tenerlo, porque da tranquilidad falsa.
 *
 * También se fija lo contrario: que con datos sanos NO avisen. Un control que
 * avisa siempre se termina ignorando, y entonces no controla nada.
 */

const DB = path.join(os.tmpdir(), `didier-test-checks-${process.pid}.db`);
let prisma: import("../app/generated/prisma/client").PrismaClient;
let checks: typeof import("../lib/checks");
let ids: { periodo: string; evento: string; activo: string; deBaja: string };

before(async () => {
  fs.rmSync(DB, { force: true });
  process.env.DATABASE_URL = `file:${DB}`;
  execFileSync("npx", ["prisma", "migrate", "deploy"], {
    env: { ...process.env, DATABASE_URL: `file:${DB}` },
    stdio: "pipe",
    shell: process.platform === "win32",
  });
  const { PrismaClient } = await import("../app/generated/prisma/client");
  const { PrismaBetterSqlite3 } = await import("@prisma/adapter-better-sqlite3");
  prisma = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: `file:${DB}` }) });
  checks = await import("../lib/checks");

  // Un período que incluye hoy, para que los controles de fecha tengan de qué agarrarse.
  const p = await prisma.operationalPeriod.create({
    data: { startDay: sumarDias(hoy(), -1), endDay: sumarDias(hoy(), 3) },
  });
  const ev = await prisma.event.create({
    data: { periodId: p.id, lugar: "El Carmen", date: instanteDe(hoy(), "21:00"), guests: 100, responsable: "Bruno" },
  });
  const activo = await prisma.product.create({
    data: { name: "Copa de agua", category: "ENSERES", type: "REUTILIZABLE", unit: "Unidad", stock: 500, active: true },
  });
  const deBaja = await prisma.product.create({
    data: { name: "Tenedor postre", category: "ENSERES", type: "REUTILIZABLE", unit: "Unidad", stock: 2000, active: false },
  });
  await prisma.orderLine.create({ data: { eventId: ev.id, productId: activo.id, qty: 80 } });
  ids = { periodo: p.id, evento: ev.id, activo: activo.id, deBaja: deBaja.id };
});

after(async () => {
  await prisma?.$disconnect();
  for (const f of [DB, `${DB}-wal`, `${DB}-shm`, `${DB}-journal`]) {
    try {
      fs.rmSync(f, { force: true });
    } catch {
      /* se lo lleva el sistema */
    }
  }
});

// --- Con datos sanos, silencio -------------------------------------------------

test("con todo en orden no avisa nada", async () => {
  const h = await checks.incoherenciasDePedido();
  assert.deepEqual(h, [], "avisó de algo que está bien: " + JSON.stringify(h));
});

// --- El caso que motivó todo ---------------------------------------------------

test("detecta el renglón que pide un producto dado de baja", async () => {
  // Exactamente el caso real: 398 tenedores de postre dados de baja, invisibles
  // en el pedido pero impresos en la hoja del depósito.
  await prisma.orderLine.create({ data: { eventId: ids.evento, productId: ids.deBaja, qty: 398 } });
  const h = await checks.pedidosConProductoDeBaja();
  assert.equal(h.length, 1);
  assert.match(h[0].message, /398/);
  assert.match(h[0].message, /Tenedor postre/);
  assert.match(h[0].message, /El Carmen/);
  assert.equal(h[0].gravedad, "alta");
  assert.equal(h[0].url, `/evento/${ids.evento}`);
});

test("si el renglón se pone en cero, deja de avisar", async () => {
  await prisma.orderLine.updateMany({ where: { productId: ids.deBaja }, data: { qty: 0 } });
  assert.deepEqual(await checks.pedidosConProductoDeBaja(), []);
  await prisma.orderLine.deleteMany({ where: { productId: ids.deBaja } });
});

test("un producto dado de baja que nadie pide no molesta a nadie", async () => {
  assert.deepEqual(await checks.pedidosConProductoDeBaja(), []);
});

// --- Las demás incoherencias ---------------------------------------------------

test("detecta un evento con pedido cargado pero sin invitados", async () => {
  await prisma.event.update({ where: { id: ids.evento }, data: { guests: 0 } });
  const h = await checks.eventosSinInvitados();
  assert.equal(h.length, 1);
  assert.match(h[0].message, /0 invitados/);
  await prisma.event.update({ where: { id: ids.evento }, data: { guests: 100 } });
});

test("un evento sin invitados PERO sin pedido no se marca: recién se está creando", async () => {
  const vacio = await prisma.event.create({
    data: { periodId: ids.periodo, lugar: "Recién creado", date: instanteDe(hoy(), "20:00"), guests: 0 },
  });
  const h = await checks.eventosSinInvitados();
  assert.equal(h.length, 0);
  await prisma.event.delete({ where: { id: vacio.id } });
});

test("detecta un evento marcado listo sin responsable", async () => {
  await prisma.event.update({ where: { id: ids.evento }, data: { status: "LISTO", responsable: null } });
  const h = await checks.eventosListosSinResponsable();
  assert.equal(h.length, 1);
  assert.match(h[0].message, /responsable/);
  await prisma.event.update({ where: { id: ids.evento }, data: { status: "NO_LISTO", responsable: "Bruno" } });
});

test("detecta un evento que ya viene y no tiene nada cargado", async () => {
  const sinPedido = await prisma.event.create({
    data: { periodId: ids.periodo, lugar: "Sin cargar", date: instanteDe(sumarDias(hoy(), 2), "21:00"), guests: 50 },
  });
  const h = await checks.eventosProximosSinPedido();
  assert.equal(h.length, 1);
  assert.match(h[0].message, /Sin cargar/);
  await prisma.event.delete({ where: { id: sinPedido.id } });
});

test("un evento lejano sin pedido todavía no molesta", async () => {
  const lejos = await prisma.operationalPeriod.create({
    data: { startDay: sumarDias(hoy(), 60), endDay: sumarDias(hoy(), 61) },
  });
  const ev = await prisma.event.create({
    data: { periodId: lejos.id, lugar: "Para diciembre", date: instanteDe(sumarDias(hoy(), 60), "21:00"), guests: 50 },
  });
  assert.deepEqual(await checks.eventosProximosSinPedido(), []);
  await prisma.event.delete({ where: { id: ev.id } });
  await prisma.operationalPeriod.delete({ where: { id: lejos.id } });
});

test("detecta un evento colgado de un período que no cubre su fecha", async () => {
  // No debería poder pasar, pero si pasa el pedido cuenta contra el stock del
  // grupo equivocado y no se nota hasta el día del evento.
  await prisma.event.update({
    where: { id: ids.evento },
    data: { date: instanteDe(sumarDias(hoy(), 40), "21:00") },
  });
  const h = await checks.eventosFueraDeSuPeriodo();
  assert.equal(h.length, 1);
  assert.equal(h[0].gravedad, "alta");
  await prisma.event.update({ where: { id: ids.evento }, data: { date: instanteDe(hoy(), "21:00") } });
  assert.deepEqual(await checks.eventosFueraDeSuPeriodo(), []);
});

test("lo que está en la papelera no se controla", async () => {
  await prisma.orderLine.create({ data: { eventId: ids.evento, productId: ids.deBaja, qty: 398 } });
  await prisma.event.update({ where: { id: ids.evento }, data: { deletedAt: new Date() } });
  assert.deepEqual(await checks.pedidosConProductoDeBaja(), [], "avisó de un evento borrado");
  await prisma.event.update({ where: { id: ids.evento }, data: { deletedAt: null } });
  await prisma.orderLine.deleteMany({ where: { productId: ids.deBaja } });
});

// --- Control de avisos ---------------------------------------------------------

test("avisa quién no va a recibir nada en el celular", async () => {
  const a = await prisma.user.create({
    data: { name: "Aldana", email: "aldana@test.local", role: "ARMADOR", passwordHash: "x" },
  });
  const b = await prisma.user.create({
    data: { name: "Enrique", email: "enrique@test.local", role: "ARMADOR", passwordHash: "x" },
  });
  const h = await checks.usuariosSinAvisos();
  assert.equal(h.length, 1);
  assert.match(h[0].message, /Aldana/);
  assert.match(h[0].message, /Enrique/);

  // Con suscripción, deja de nombrarla.
  await prisma.pushSubscription.create({
    data: { userId: a.id, endpoint: "https://fcm.googleapis.com/x1", p256dh: "k", auth: "k" },
  });
  const h2 = await checks.usuariosSinAvisos();
  assert.equal(h2.length, 1);
  assert.equal(/Aldana/.test(h2[0].message), false);
  assert.match(h2[0].message, /Enrique/);
  await prisma.user.delete({ where: { id: b.id } });
});

test("detecta una suscripción que quedó sin dueño", async () => {
  // `PushSubscription.userId` no tiene relación formal con `User`: al borrar a
  // alguien su suscripción puede quedar mandando avisos a un teléfono ajeno.
  const u = await prisma.user.findFirst({ where: { name: "Aldana" } });
  assert.ok(u);
  await prisma.pushSubscription.create({
    data: { userId: "usuario-que-no-existe", endpoint: "https://fcm.googleapis.com/huerfana", p256dh: "k", auth: "k" },
  });
  const h = await checks.suscripcionesHuerfanas();
  assert.equal(h.length, 1);
  assert.equal(h[0].gravedad, "alta");
  assert.match(h[0].message, /sin dueño/);
  await prisma.pushSubscription.deleteMany({ where: { userId: "usuario-que-no-existe" } });
  assert.deepEqual(await checks.suscripcionesHuerfanas(), []);
});

test("revisarTodo junta las dos familias y ordena lo grave primero", async () => {
  await prisma.orderLine.create({ data: { eventId: ids.evento, productId: ids.deBaja, qty: 12 } });
  const h = await checks.revisarTodo();
  assert.ok(h.length >= 1);
  assert.equal(h[0].gravedad, "alta", "lo más grave tiene que ir primero");
  await prisma.orderLine.deleteMany({ where: { productId: ids.deBaja } });
});

test("ningún control escribe: solo miran", async () => {
  const antes = {
    eventos: await prisma.event.count(),
    lineas: await prisma.orderLine.count(),
    productos: await prisma.product.count(),
    periodos: await prisma.operationalPeriod.count(),
  };
  await checks.revisarTodo();
  assert.deepEqual(
    {
      eventos: await prisma.event.count(),
      lineas: await prisma.orderLine.count(),
      productos: await prisma.product.count(),
      periodos: await prisma.operationalPeriod.count(),
    },
    antes
  );
});

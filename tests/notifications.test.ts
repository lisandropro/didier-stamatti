import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";

/**
 * El agrupamiento de avisos, contra una base de verdad.
 *
 * Se prueba acá y no a mano porque la regla es fácil de romper sin darse cuenta:
 * "un solo aviso por tanda, cinco minutos después del último cambio" depende de
 * tres cosas que viven en archivos distintos (la marca de tiempo compartida, la
 * búsqueda del aviso abierto y el barrido). Ya se rompió una vez, cuando el
 * cambio se guardaba con su propio reloj y el resumen se comía el primero.
 *
 * Cada corrida usa una base nueva y descartable: no toca dev.db ni producción.
 */

const DB = path.join(os.tmpdir(), `didier-test-avisos-${process.pid}.db`);
let prisma: import("../app/generated/prisma/client").PrismaClient;
let notify: typeof import("../lib/notify");
let ids: { admin: string; logistica: string; armador: string; evento: string };

before(async () => {
  fs.rmSync(DB, { force: true });
  process.env.DATABASE_URL = `file:${DB}`;
  // La misma migración que corre en producción, sobre la base descartable.
  execFileSync("npx", ["prisma", "migrate", "deploy"], {
    env: { ...process.env, DATABASE_URL: `file:${DB}` },
    stdio: "pipe",
    shell: process.platform === "win32",
  });

  const { PrismaClient } = await import("../app/generated/prisma/client");
  const { PrismaBetterSqlite3 } = await import("@prisma/adapter-better-sqlite3");
  prisma = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: `file:${DB}` }) });
  notify = await import("../lib/notify");

  const mk = (name: string, role: string) =>
    prisma.user.create({ data: { name, email: `${role}@test.local`, role, passwordHash: "x" } });
  const admin = await mk("Ana", "ADMIN");
  const logistica = await mk("Pablo", "LOGISTICA");
  const armador = await mk("Enrique", "ARMADOR");
  const wk = await prisma.weekend.create({
    data: { label: "Prueba", startDate: new Date("2026-08-15"), endDate: new Date("2026-08-16") },
  });
  const ev = await prisma.event.create({
    data: { weekendId: wk.id, lugar: "El Carmen Center", date: new Date("2026-08-15"), guests: 100 },
  });
  ids = { admin: admin.id, logistica: logistica.id, armador: armador.id, evento: ev.id };
});

after(async () => {
  await prisma?.$disconnect();
  // En Windows el archivo puede seguir tomado un instante después de cerrar.
  // Que no se pueda borrar el descartable no es motivo para dar la prueba por
  // fallada: queda en la carpeta temporal del sistema y se limpia solo.
  for (const f of [DB, `${DB}-wal`, `${DB}-shm`, `${DB}-journal`]) {
    try {
      fs.rmSync(f, { force: true });
    } catch {
      /* se lo lleva el sistema */
    }
  }
});

const ACTOR = () => ({ id: ids.admin, name: "Ana" });
const avisos = (recipientId: string) =>
  prisma.notification.findMany({ where: { recipientId, type: "ORDER_EDIT" }, orderBy: { createdAt: "desc" } });

async function limpiar() {
  await prisma.notification.deleteMany({});
  await prisma.orderChange.deleteMany({});
}

/** Corre el reloj hacia atrás: simula que pasaron los minutos de quietud. */
async function pasaronMinutos(n: number) {
  await prisma.notification.updateMany({
    where: { pushedAt: null },
    data: { createdAt: new Date(Date.now() - n * 60 * 1000) },
  });
}

test("cuatro cambios seguidos son UN solo aviso por persona", async () => {
  await limpiar();
  for (const c of [
    { itemName: "Copa de agua", kind: "CANTIDAD" as const, before: "10", after: "24" },
    { itemName: "Servilletas", kind: "AGREGADO" as const, before: null, after: "50" },
    { itemName: "Brasero", kind: "QUITADO" as const, before: "3", after: null },
    { itemName: "Mantel", kind: "NOTA" as const, before: "", after: "los largos" },
  ]) {
    await notify.notifyOrderChange(ACTOR(), ids.evento, c);
  }
  const p = await avisos(ids.logistica);
  const e = await avisos(ids.armador);
  assert.equal(p.length, 1);
  assert.equal(e.length, 1);
  assert.equal(p[0].changeCount, 4);
});

test("el aviso nombra a quien lo cambió y el evento", async () => {
  const [a] = await avisos(ids.logistica);
  assert.match(a.message, /Ana/);
  assert.match(a.message, /El Carmen Center/);
  assert.equal(a.eventId, ids.evento);
});

test("el resumen no se come el primer cambio de la tanda", async () => {
  // Los cambios se buscan desde `sinceAt`. Si el cambio se guardara con un reloj
  // propio, caería milisegundos antes y el primero desaparecería del detalle.
  const [a] = await avisos(ids.logistica);
  const cambios = await prisma.orderChange.findMany({
    where: { eventId: ids.evento, actorName: a.actorName, createdAt: { gte: a.sinceAt } },
  });
  assert.equal(cambios.length, 4);
});

test("quien hace el cambio no se avisa a sí mismo", async () => {
  assert.equal((await avisos(ids.admin)).length, 0);
});

test("guardar sin cambiar nada no genera aviso", async () => {
  const antes = (await avisos(ids.logistica)).length;
  await notify.notifyOrderChange(ACTOR(), ids.evento, []);
  assert.equal((await avisos(ids.logistica)).length, antes);
});

test("mientras la edición sigue viva no sale ningún push", async () => {
  const r = await notify.flushPendingOrderPushes();
  assert.equal(r.enviados, 0);
});

test("pasados los 5 minutos de quietud sale un push por persona", async () => {
  await pasaronMinutos(6);
  const r = await notify.flushPendingOrderPushes();
  assert.equal(r.enviados, 2);
});

test("un segundo barrido no manda duplicados", async () => {
  const r = await notify.flushPendingOrderPushes();
  assert.equal(r.enviados, 0);
  assert.equal(await prisma.notification.count({ where: { type: "ORDER_EDIT", pushedAt: null } }), 0);
});

test("un cambio posterior abre tanda nueva en vez de colarse en la ya avisada", async () => {
  await notify.notifyOrderChange(ACTOR(), ids.evento, {
    itemName: "Fuente", kind: "CANTIDAD", before: "2", after: "6",
  });
  const p = await avisos(ids.logistica);
  assert.equal(p.length, 2);
  assert.equal(p[0].changeCount, 1);
});

test("un aviso ya leído en la app no hace sonar el teléfono", async () => {
  await limpiar();
  await notify.notifyOrderChange(ACTOR(), ids.evento, { itemName: "Copa", kind: "CANTIDAD", before: "1", after: "2" });
  await prisma.notification.updateMany({ where: { recipientId: ids.logistica }, data: { read: true } });
  await pasaronMinutos(6);
  const r = await notify.flushPendingOrderPushes();
  assert.equal(r.enviados, 1); // solo el de Enrique
  assert.equal(r.cerrados, 2);
});

test("el cambio de responsable también avisa", async () => {
  await limpiar();
  await notify.notifyOrderChange(ACTOR(), ids.evento, {
    itemName: "Responsable de la fiesta", kind: "RESPONSABLE", before: null, after: "Pablo",
  });
  const [a] = await avisos(ids.logistica);
  assert.equal(a.changeCount, 1);
  const [c] = await prisma.orderChange.findMany({ where: { kind: "RESPONSABLE" } });
  assert.equal(c.after, "Pablo");
});

test("cada quien ve solo sus avisos", async () => {
  const p = await avisos(ids.logistica);
  const e = await avisos(ids.armador);
  assert.ok(p.length > 0 && e.length > 0);
  assert.equal(p.every((x) => x.recipientId === ids.logistica), true);
  assert.equal(e.every((x) => x.recipientId === ids.armador), true);
});

test("un evento que no existe no rompe el guardado del pedido", async () => {
  await assert.doesNotReject(() =>
    notify.notifyOrderChange(ACTOR(), "id-que-no-existe", { itemName: "x", kind: "CANTIDAD", after: "1" })
  );
});

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { findeCubre, elegirFinde, proponerFinde, soloDia, aISO } from "../lib/weekend-fit";
import { planEventEdit } from "../lib/event-edit";
import {
  canManageWeekends,
  canEditOrders,
  canEditStock,
  canSetResponsable,
  ROLES,
} from "../lib/permissions";

/**
 * Corregir el nombre y la fecha de un evento que ya tiene el pedido cargado.
 *
 * Lo que se protege acá: que el pedido no se toque, que el evento termine en el
 * fin de semana que le corresponde, y que el cambio quede registrado. Un error
 * en esto no se ve el día que pasa — se ve el sábado, cuando falta la vajilla
 * porque estaba contada contra el finde equivocado.
 */

// --- Permisos -----------------------------------------------------------------

const PUEDE_EDITAR = { ADMIN: true, ARMADOR: true, LOGISTICA: false } as const;

for (const rol of Object.keys(PUEDE_EDITAR) as (keyof typeof PUEDE_EDITAR)[]) {
  test(`${rol}: puede corregir un evento = ${PUEDE_EDITAR[rol]}`, () => {
    assert.equal(canManageWeekends(rol), PUEDE_EDITAR[rol]);
  });
}

test("la tabla cubre todos los roles: si se agrega uno, esta prueba falla", () => {
  assert.deepEqual([...ROLES].sort(), Object.keys(PUEDE_EDITAR).sort());
});

test("al encargado de logística no se le tocó ningún permiso", () => {
  assert.equal(canManageWeekends("LOGISTICA"), false);
  assert.equal(canEditOrders("LOGISTICA"), false);
  assert.equal(canEditStock("LOGISTICA"), false);
  // Lo único que sí podía y sigue pudiendo.
  assert.equal(canSetResponsable("LOGISTICA"), true);
});

test("un rol inventado no puede corregir eventos", () => {
  assert.equal(canManageWeekends("SUPERUSUARIO"), false);
  assert.equal(canManageWeekends(""), false);
});

// --- A qué finde pertenece una fecha -------------------------------------------

const finde = (id: string, label: string, a: string, b: string) => ({
  id,
  label,
  startDate: new Date(a + "T00:00"),
  endDate: new Date(b + "T00:00"),
});

test("los dos extremos del fin de semana cuentan como adentro", () => {
  const w = finde("w1", "15 al 16 ago", "2026-08-15", "2026-08-16");
  assert.equal(findeCubre(w, new Date("2026-08-15T09:00")), true);
  assert.equal(findeCubre(w, new Date("2026-08-16T23:30")), true);
  assert.equal(findeCubre(w, new Date("2026-08-14T20:00")), false);
  assert.equal(findeCubre(w, new Date("2026-08-17T00:30")), false);
});

test("un evento a la noche del último día sigue estando adentro", () => {
  // El finde guarda sus extremos a medianoche: comparando por instante, un
  // evento del domingo a las 21hs quedaría "después" del domingo.
  const w = finde("w1", "15 al 16 ago", "2026-08-15", "2026-08-16");
  assert.ok(new Date("2026-08-16T21:00") > w.endDate, "el instante es posterior");
  assert.equal(findeCubre(w, new Date("2026-08-16T21:00")), true, "pero el día es el mismo");
});

test("si la fecha nueva sigue cayendo en su finde, el evento no se muda", () => {
  const a = finde("w1", "14 al 15 ago", "2026-08-14", "2026-08-15");
  const b = finde("w2", "15 al 16 ago", "2026-08-15", "2026-08-16");
  // El 15 cae en los dos. Estando en w2, se queda en w2.
  assert.equal(elegirFinde([a, b], new Date("2026-08-15T18:00"), "w2")!.id, "w2");
  // Y estando en w1, se queda en w1.
  assert.equal(elegirFinde([a, b], new Date("2026-08-15T18:00"), "w1")!.id, "w1");
});

test("si el finde actual ya no cubre la fecha, se elige el que empieza primero", () => {
  const a = finde("w1", "14 al 15 ago", "2026-08-14", "2026-08-15");
  const b = finde("w2", "15 al 16 ago", "2026-08-15", "2026-08-16");
  // Estaba en un finde de julio; la fecha nueva cae en los dos de agosto.
  assert.equal(elegirFinde([a, b], new Date("2026-08-15T18:00"), "w-viejo")!.id, "w1");
});

test("si ningún finde cubre la fecha, no se elige ninguno", () => {
  const a = finde("w1", "15 al 16 ago", "2026-08-15", "2026-08-16");
  assert.equal(elegirFinde([a], new Date("2026-09-05T18:00"), "w1"), null);
});

test("el finde propuesto para un sábado es ese viernes a domingo", () => {
  const p = proponerFinde(new Date("2026-08-15T21:00")); // sábado
  assert.equal(aISO(p.startDate), "2026-08-14");
  assert.equal(aISO(p.endDate), "2026-08-16");
});

test("y para un domingo, el mismo fin de semana, no el siguiente", () => {
  const p = proponerFinde(new Date("2026-08-16T21:00")); // domingo
  assert.equal(aISO(p.startDate), "2026-08-14");
  assert.equal(aISO(p.endDate), "2026-08-16");
});

test("el finde propuesto siempre cubre la fecha que lo originó", () => {
  for (const iso of [
    "2026-08-12T20:00", // miércoles
    "2026-08-14T20:00", // viernes
    "2026-08-15T20:00", // sábado
    "2026-08-16T20:00", // domingo
    "2026-12-31T23:00",
    "2027-01-01T01:00",
  ]) {
    const d = new Date(iso);
    const p = proponerFinde(d);
    assert.equal(findeCubre(p, d), true, `el propuesto para ${iso} no lo cubre`);
  }
});

test("soloDia deja la fecha a medianoche", () => {
  const d = soloDia(new Date("2026-08-15T23:59"));
  assert.equal(d.getHours(), 0);
  assert.equal(d.getDate(), 15);
});

// --- Qué se decide al corregir --------------------------------------------------

const W_A = finde("wA", "14 al 15 ago", "2026-08-14", "2026-08-15");
const W_B = finde("wB", "22 al 23 ago", "2026-08-22", "2026-08-23");
const ACTUAL = {
  lugar: "El Carmen",
  date: new Date("2026-08-15T18:00"),
  guests: 110,
  weekendId: "wA",
  weekendLabel: "14 al 15 ago",
};

test("corregir solo el nombre no muda de finde", () => {
  const p = planEventEdit(ACTUAL, { lugar: "El Carmen Center", date: ACTUAL.date, guests: 110 }, [W_A, W_B]);
  assert.equal(p.tipo, "guardar");
  if (p.tipo !== "guardar") return;
  assert.equal(p.semudó, false);
  assert.equal(p.destinoId, "wA");
  assert.deepEqual(
    p.cambios.map((c) => c.kind),
    ["LUGAR"]
  );
  assert.equal(p.cambios[0].before, "El Carmen");
  assert.equal(p.cambios[0].after, "El Carmen Center");
});

test("corregir la fecha a otro finde muda el evento y lo deja anotado", () => {
  const p = planEventEdit(ACTUAL, { lugar: ACTUAL.lugar, date: new Date("2026-08-22T18:00"), guests: 110 }, [W_A, W_B]);
  assert.equal(p.tipo, "guardar");
  if (p.tipo !== "guardar") return;
  assert.equal(p.semudó, true);
  assert.equal(p.destinoId, "wB");
  assert.deepEqual(
    p.cambios.map((c) => c.kind).sort(),
    ["FECHA", "FINDE"]
  );
  const mudanza = p.cambios.find((c) => c.kind === "FINDE")!;
  assert.equal(mudanza.before, "14 al 15 ago");
  assert.equal(mudanza.after, "22 al 23 ago");
});

test("cambiar la hora dentro del mismo día no muda de finde", () => {
  const p = planEventEdit(ACTUAL, { lugar: ACTUAL.lugar, date: new Date("2026-08-15T21:30"), guests: 110 }, [W_A, W_B]);
  assert.equal(p.tipo, "guardar");
  if (p.tipo !== "guardar") return;
  assert.equal(p.semudó, false);
  assert.deepEqual(
    p.cambios.map((c) => c.kind),
    ["FECHA"]
  );
});

test("guardar sin cambiar nada no genera nada que guardar", () => {
  const p = planEventEdit(ACTUAL, { lugar: "El Carmen", date: ACTUAL.date, guests: 110 }, [W_A, W_B]);
  assert.equal(p.tipo, "sin-cambios");
});

test("los espacios de más no cuentan como un cambio", () => {
  const p = planEventEdit(ACTUAL, { lugar: "  El Carmen  ", date: ACTUAL.date, guests: 110 }, [W_A, W_B]);
  assert.equal(p.tipo, "sin-cambios");
});

test("una fecha sin fin de semana pide crear uno antes de tocar nada", () => {
  const p = planEventEdit(ACTUAL, { lugar: ACTUAL.lugar, date: new Date("2026-09-19T18:00"), guests: 110 }, [W_A, W_B]);
  assert.equal(p.tipo, "falta-finde");
  if (p.tipo !== "falta-finde") return;
  assert.equal(p.startDate, "2026-09-18");
  assert.equal(p.endDate, "2026-09-20");
});

test("el lugar vacío se rechaza", () => {
  const p = planEventEdit(ACTUAL, { lugar: "   ", date: ACTUAL.date, guests: 110 }, [W_A, W_B]);
  assert.equal(p.tipo, "error");
});

test("una fecha inválida se rechaza en vez de guardar cualquier cosa", () => {
  const p = planEventEdit(ACTUAL, { lugar: ACTUAL.lugar, date: new Date("no es fecha"), guests: 110 }, [W_A, W_B]);
  assert.equal(p.tipo, "error");
});

test("los invitados negativos se llevan a cero", () => {
  const p = planEventEdit(ACTUAL, { lugar: ACTUAL.lugar, date: ACTUAL.date, guests: -5 }, [W_A, W_B]);
  assert.equal(p.tipo, "guardar");
  if (p.tipo !== "guardar") return;
  assert.equal(p.cambios.find((c) => c.kind === "INVITADOS")!.after, "0");
});

test("el plan nunca deja el evento en un finde que no cubre su fecha", () => {
  // Se prueban muchas fechas contra dos findes reales: o se muda a uno que la
  // cubre, o pide crear uno. Nunca devuelve un destino que no sirva.
  const findes = [W_A, W_B];
  for (let dia = 1; dia <= 31; dia++) {
    const d = new Date(2026, 7, dia, 20, 0); // agosto
    const p = planEventEdit(ACTUAL, { lugar: "X" + dia, date: d, guests: 110 }, findes);
    if (p.tipo === "guardar") {
      const destino = findes.find((w) => w.id === p.destinoId)!;
      assert.equal(findeCubre(destino, d), true, `el ${dia}/8 quedó en un finde que no lo cubre`);
    } else {
      assert.equal(p.tipo, "falta-finde", `el ${dia}/8 devolvió ${p.tipo}`);
    }
  }
});

// --- Contra la base: el pedido no se toca ---------------------------------------

const DB = path.join(os.tmpdir(), `didier-test-evento-${process.pid}.db`);
let prisma: import("../app/generated/prisma/client").PrismaClient;
let notify: typeof import("../lib/notify");
let ids: { admin: string; armador: string; logistica: string; wA: string; wB: string; evento: string };

before(async () => {
  fs.rmSync(DB, { force: true });
  // Antes de importar nada que use la base: `lib/notify` arma su cliente al
  // cargarse, y sin esto escribiría en la base de desarrollo de verdad.
  process.env.DATABASE_URL = `file:${DB}`;
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
  const armador = await mk("Enrique", "ARMADOR");
  const logistica = await mk("Pablo", "LOGISTICA");

  const wA = await prisma.weekend.create({
    data: { label: "14 al 15 ago", startDate: new Date("2026-08-14T00:00"), endDate: new Date("2026-08-15T00:00") },
  });
  const wB = await prisma.weekend.create({
    data: { label: "22 al 23 ago", startDate: new Date("2026-08-22T00:00"), endDate: new Date("2026-08-23T00:00") },
  });
  const ev = await prisma.event.create({
    data: { weekendId: wA.id, lugar: "El Carmen", date: new Date("2026-08-15T18:00"), guests: 110 },
  });
  // Un pedido de verdad: productos del catálogo, un ítem suelto y notas.
  const p1 = await prisma.product.create({
    data: { name: "Copa de agua", category: "ENSERES", type: "REUTILIZABLE", unit: "Unidad", stock: 100 },
  });
  const p2 = await prisma.product.create({
    data: { name: "Bandeja mozo", category: "ENSERES", type: "REUTILIZABLE", unit: "Unidad", stock: 20 },
  });
  await prisma.orderLine.create({ data: { eventId: ev.id, productId: p1.id, qty: 80, note: "las altas" } });
  await prisma.orderLine.create({ data: { eventId: ev.id, productId: p2.id, qty: 15, note: null } });
  await prisma.orderLine.create({
    data: { eventId: ev.id, customName: "Hielo", customCategory: "BEBIDA", customUnit: "Bolsa", qty: 12, note: "seco" },
  });

  ids = { admin: admin.id, armador: armador.id, logistica: logistica.id, wA: wA.id, wB: wB.id, evento: ev.id };
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

/** Foto del pedido, para comparar antes y después. */
async function fotoDelPedido(eventId: string) {
  const lineas = await prisma.orderLine.findMany({ where: { eventId }, orderBy: { id: "asc" } });
  return lineas.map((l) => ({
    id: l.id,
    productId: l.productId,
    customName: l.customName,
    customUnit: l.customUnit,
    qty: l.qty,
    note: l.note,
  }));
}

/** Lo que hace la acción al guardar, sin el revalidatePath de Next. */
async function guardar(actorId: string, actorName: string, pedido: { lugar: string; date: Date; guests: number }) {
  const ev = (await prisma.event.findUnique({
    where: { id: ids.evento },
    include: { weekend: { select: { label: true } } },
  }))!;
  const findes = await prisma.weekend.findMany({
    where: { deletedAt: null },
    select: { id: true, label: true, startDate: true, endDate: true },
  });
  const plan = planEventEdit(
    { lugar: ev.lugar, date: ev.date, guests: ev.guests, weekendId: ev.weekendId, weekendLabel: ev.weekend.label },
    pedido,
    findes
  );
  if (plan.tipo !== "guardar") return plan;
  await prisma.event.update({
    where: { id: ev.id },
    data: {
      lugar: pedido.lugar.trim(),
      date: pedido.date,
      guests: Math.max(0, Math.round(pedido.guests)),
      weekendId: plan.destinoId,
    },
  });
  await notify.notifyOrderChange({ id: actorId, name: actorName }, ev.id, plan.cambios);
  return plan;
}

test("el pedido queda exactamente igual después de corregir nombre y fecha", async () => {
  const antes = await fotoDelPedido(ids.evento);
  assert.equal(antes.length, 3);

  await guardar(ids.armador, "Enrique", {
    lugar: "El Carmen Center",
    date: new Date("2026-08-22T18:00"),
    guests: 110,
  });

  const despues = await fotoDelPedido(ids.evento);
  assert.deepEqual(despues, antes, "alguna línea cambió, se perdió o se duplicó");
});

test("el evento se mudó de fin de semana conservando su identificador", async () => {
  const ev = (await prisma.event.findUnique({ where: { id: ids.evento } }))!;
  assert.equal(ev.id, ids.evento);
  assert.equal(ev.weekendId, ids.wB);
  assert.equal(ev.lugar, "El Carmen Center");
});

test("los faltantes se calculan en el finde nuevo y ya no en el viejo", async () => {
  const enFinde = async (weekendId: string) =>
    (await prisma.orderLine.findMany({ where: { event: { weekendId, deletedAt: null } } })).reduce(
      (n, l) => n + l.qty,
      0
    );
  assert.equal(await enFinde(ids.wA), 0, "el finde de origen todavía cuenta el pedido");
  assert.equal(await enFinde(ids.wB), 80 + 15 + 12, "el finde de destino no cuenta el pedido");
});

test("no se tocó el responsable ni el estado", async () => {
  const ev = (await prisma.event.findUnique({ where: { id: ids.evento } }))!;
  assert.equal(ev.responsable, null);
  assert.equal(ev.status, "NO_LISTO");
});

test("no se tocó el stock ni sus movimientos", async () => {
  assert.equal(await prisma.stockMovement.count(), 0);
  const copa = await prisma.product.findFirst({ where: { name: "Copa de agua" } });
  assert.equal(copa?.stock, 100);
});

test("el historial guarda qué cambió, con el antes y el después", async () => {
  const cambios = await prisma.orderChange.findMany({
    where: { eventId: ids.evento },
    orderBy: { createdAt: "asc" },
  });
  const porTipo = new Map(cambios.map((c) => [c.kind, c]));

  const nombre = porTipo.get("LUGAR")!;
  assert.equal(nombre.before, "El Carmen");
  assert.equal(nombre.after, "El Carmen Center");
  assert.equal(nombre.actorName, "Enrique");
  assert.ok(nombre.createdAt instanceof Date);

  const fecha = porTipo.get("FECHA")!;
  assert.match(fecha.before!, /15\/8/);
  assert.match(fecha.after!, /22\/8/);

  const mudanza = porTipo.get("FINDE")!;
  assert.equal(mudanza.before, "14 al 15 ago");
  assert.equal(mudanza.after, "22 al 23 ago");
});

test("le avisa a los demás y no a quien lo hizo", async () => {
  const paraArmador = await prisma.notification.count({ where: { recipientId: ids.armador, type: "ORDER_EDIT" } });
  assert.equal(paraArmador, 0, "Enrique se avisó a sí mismo");
  for (const quien of [ids.admin, ids.logistica]) {
    const n = await prisma.notification.findFirst({ where: { recipientId: quien, type: "ORDER_EDIT" } });
    assert.ok(n, "no le llegó el aviso");
    assert.equal(n.eventId, ids.evento);
  }
});

test("el aviso nombra al evento ya corregido, no al que estaba mal", async () => {
  const n = (await prisma.notification.findFirst({
    where: { recipientId: ids.admin, type: "ORDER_EDIT" },
    orderBy: { createdAt: "desc" },
  }))!;
  assert.match(n.message, /El Carmen Center/);
});

test("Pablo sale primero de la cola de avisos", async () => {
  const { sortByNotificationPriority } = await import("../lib/permissions");
  const pendientes = await prisma.notification.findMany({
    where: { type: "ORDER_EDIT" },
    include: { recipient: { select: { role: true, name: true } } },
  });
  const orden = sortByNotificationPriority(pendientes.map((n) => ({ ...n, role: n.recipient.role })));
  assert.equal(orden[0].recipient.role, "LOGISTICA");
});

test("corregir un evento sin pedido tampoco rompe nada", async () => {
  const vacio = await prisma.event.create({
    data: { weekendId: ids.wA, lugar: "Sin pedido", date: new Date("2026-08-15T20:00"), guests: 0 },
  });
  const ev = (await prisma.event.findUnique({
    where: { id: vacio.id },
    include: { weekend: { select: { label: true } } },
  }))!;
  const findes = await prisma.weekend.findMany({
    where: { deletedAt: null },
    select: { id: true, label: true, startDate: true, endDate: true },
  });
  const plan = planEventEdit(
    { lugar: ev.lugar, date: ev.date, guests: ev.guests, weekendId: ev.weekendId, weekendLabel: ev.weekend.label },
    { lugar: "Renombrado", date: ev.date, guests: 50 },
    findes
  );
  assert.equal(plan.tipo, "guardar");
  assert.equal(await prisma.orderLine.count({ where: { eventId: vacio.id } }), 0);
});

test("las versiones guardadas no se tocan al corregir un evento", async () => {
  assert.equal(await prisma.weekendVersion.count(), 0);
  assert.equal(await prisma.weekendSnapshot.count(), 0);
});

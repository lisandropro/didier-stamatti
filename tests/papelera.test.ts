import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";

// Solo `lib/dates`, que no toca la base. `lib/trash` se importa dentro de
// before(), DESPUÉS de apuntar DATABASE_URL a la base de prueba: `lib/db` arma
// su cliente al cargarse, y un import de arriba haría que esto borre cosas de
// la base de desarrollo.
import { instanteDe, lunesMasReciente } from "../lib/dates";

/**
 * El vaciado automático de la papelera.
 *
 * Esto borra cosas para siempre, así que la prueba se pregunta dos cosas en
 * cada caso: se fue lo que tenía que irse, y **sigue estando todo lo demás**.
 *
 * La regla es por fecha y no por reloj: se borra lo que ya estaba en la
 * papelera antes del lunes más reciente. Escrito así, el barrido da lo mismo
 * cuántas veces corra y qué día lo haga — si el servidor estuvo apagado el
 * lunes, el martes limpia igual. Un disparo atado al reloj se hubiera salteado
 * ese lunes en silencio.
 */

// ---------------------------------------------------------------------------
// El corte, sin base
// ---------------------------------------------------------------------------

// Agosto de 2026: el 17 es lunes.
test("un lunes, el corte es ese mismo lunes", () => {
  assert.equal(lunesMasReciente("2026-08-17"), "2026-08-17");
});

test("cada día de la semana mira al lunes que ya pasó, nunca al que viene", () => {
  const esperado: Record<string, string> = {
    "2026-08-17": "2026-08-17", // lunes
    "2026-08-18": "2026-08-17", // martes
    "2026-08-19": "2026-08-17", // miércoles
    "2026-08-20": "2026-08-17", // jueves
    "2026-08-21": "2026-08-17", // viernes
    "2026-08-22": "2026-08-17", // sábado
    "2026-08-23": "2026-08-17", // domingo: el lunes fue hace seis días
    "2026-08-24": "2026-08-24", // lunes siguiente
  };
  for (const [dia, lunes] of Object.entries(esperado)) {
    assert.equal(lunesMasReciente(dia), lunes, `fallo en ${dia}`);
  }
});

test("el corte cruza fin de mes y fin de año sin inventar fechas", () => {
  assert.equal(lunesMasReciente("2026-09-02"), "2026-08-31");
  assert.equal(lunesMasReciente("2027-01-01"), "2026-12-28");
});

// ---------------------------------------------------------------------------
// El barrido, contra la base
// ---------------------------------------------------------------------------

const DB = path.join(os.tmpdir(), `papelera-${process.pid}.db`);
const HOY = "2026-08-18"; // martes; el lunes más reciente es el 17

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let prisma: any;
let vaciarPapelera: (dia?: string) => Promise<{ periodos: number; eventos: number; avisos: number }>;
let productoId: string;
let usuarioId: string;

const laSemanaPasada = instanteDe("2026-08-14", "10:00"); // viernes anterior al corte
const esteLunes = instanteDe("2026-08-17", "09:00"); // ya pasado el corte de las 00:00

async function periodo(opts: { deletedAt?: Date; label: string }) {
  return prisma.operationalPeriod.create({
    data: { label: opts.label, startDay: "2026-08-01", endDay: "2026-08-02", deletedAt: opts.deletedAt ?? null },
  });
}

async function evento(periodId: string, opts: { lugar: string; deletedAt?: Date }) {
  const e = await prisma.event.create({
    data: {
      lugar: opts.lugar,
      date: instanteDe("2026-08-01", "21:00"),
      guests: 50,
      periodId,
      deletedAt: opts.deletedAt ?? null,
    },
  });
  await prisma.orderLine.create({ data: { eventId: e.id, productId: productoId, qty: 10 } });
  await prisma.orderChange.create({
    data: { eventId: e.id, actorName: "Pablo", itemName: "Copa de agua", kind: "CANTIDAD", before: "0", after: "10" },
  });
  await prisma.notification.create({
    data: { recipientId: usuarioId, actorName: "Pablo", type: "ORDER_EDIT", message: "cambió algo", eventId: e.id },
  });
  return e;
}

before(async () => {
  fs.rmSync(DB, { force: true });
  // ANTES de importar nada que use la base: `lib/db` arma su cliente al
  // cargarse, y sin esto la prueba borraría cosas de la base de desarrollo.
  process.env.DATABASE_URL = `file:${DB}`;
  execFileSync("npx", ["prisma", "migrate", "deploy"], {
    env: { ...process.env, DATABASE_URL: `file:${DB}` },
    stdio: "pipe",
    shell: process.platform === "win32",
  });
  ({ vaciarPapelera } = await import("../lib/trash"));
  ({ prisma } = await import("../lib/db"));

  const p = await prisma.product.create({
    data: { name: "Copa de agua", category: "ENSERES", type: "REUTILIZABLE", unit: "Unidad", stock: 100 },
  });
  productoId = p.id;
  const u = await prisma.user.create({
    data: { name: "Pablo", email: "pablo@ejemplo.com", passwordHash: "x", role: "LOGISTICA" },
  });
  usuarioId = u.id;
});

test("se borra lo que estaba en la papelera desde antes del lunes, y nada más", async () => {
  const viejo = await periodo({ label: "tirado la semana pasada", deletedAt: laSemanaPasada });
  await evento(viejo.id, { lugar: "La Quinta" });

  const reciente = await periodo({ label: "tirado este lunes", deletedAt: esteLunes });
  await evento(reciente.id, { lugar: "El Molino" });

  const vivo = await periodo({ label: "en uso" });
  const eventoVivo = await evento(vivo.id, { lugar: "Puerto arriba" });
  const eventoTirado = await evento(vivo.id, { lugar: "Esperanza", deletedAt: laSemanaPasada });

  const r = await vaciarPapelera(HOY);
  assert.equal(r.periodos, 1, "solo el período tirado antes del lunes");
  assert.equal(r.eventos, 1, "solo el evento suelto tirado antes del lunes");

  const quedan = await prisma.operationalPeriod.findMany({ select: { label: true } });
  assert.deepEqual(quedan.map((p: { label: string }) => p.label).sort(), ["en uso", "tirado este lunes"]);

  const lugares = await prisma.event.findMany({ select: { lugar: true } });
  assert.deepEqual(lugares.map((e: { lugar: string }) => e.lugar).sort(), ["El Molino", "Puerto arriba"]);

  assert.ok(await prisma.event.findUnique({ where: { id: eventoVivo.id } }), "el evento vivo sigue");
  assert.equal(await prisma.event.findUnique({ where: { id: eventoTirado.id } }), null, "el tirado se fue");
});

test("el pedido y el historial del evento borrado se van con él", async () => {
  assert.equal(await prisma.orderLine.count(), 2, "quedan los pedidos de los dos eventos vivos");
  assert.equal(await prisma.orderChange.count(), 2);
});

test("los avisos que apuntaban a un evento borrado no quedan llevando a la nada", async () => {
  const avisos = await prisma.notification.findMany({ select: { eventId: true } });
  const ids = (await prisma.event.findMany({ select: { id: true } })).map((e: { id: string }) => e.id);
  assert.equal(avisos.length, 2, "queda un aviso por cada evento que sigue existiendo");
  for (const a of avisos) assert.ok(ids.includes(a.eventId), "ningún aviso apunta a un evento que ya no está");
});

test("el stock, los productos y los usuarios no se tocan", async () => {
  assert.equal(await prisma.product.count(), 1);
  assert.equal((await prisma.product.findFirst()).stock, 100);
  assert.equal(await prisma.user.count(), 1);
});

test("correrlo de nuevo el mismo día no borra nada", async () => {
  const antes = await prisma.event.count();
  const r = await vaciarPapelera(HOY);
  assert.deepEqual({ periodos: r.periodos, eventos: r.eventos, avisos: r.avisos }, { periodos: 0, eventos: 0, avisos: 0 });
  assert.equal(await prisma.event.count(), antes);
});

test("lo tirado este lunes aguanta hasta el lunes siguiente", async () => {
  // El martes 25 ya pasó el lunes 24: recién ahí le toca.
  assert.equal((await vaciarPapelera("2026-08-23")).periodos, 0, "el domingo todavía no");
  assert.equal((await vaciarPapelera("2026-08-25")).periodos, 1, "el martes siguiente sí");
});

test("las copias guardadas de un período vivo sobreviven al barrido", async () => {
  const vivo = await prisma.operationalPeriod.findFirst({ where: { label: "en uso" } });
  await prisma.periodVersion.create({
    data: { periodId: vivo.id, kind: "PRE_DESCARTE", lineCount: 3, actorName: "Lisandro", data: "[]" },
  });
  await vaciarPapelera(HOY);
  assert.equal(await prisma.periodVersion.count(), 1, "no son basura: son la forma de deshacer un cambio");
});

test("una papelera vacía no rompe nada", async () => {
  const r = await vaciarPapelera("2027-03-02");
  assert.equal(r.periodos + r.eventos + r.avisos, 0);
});

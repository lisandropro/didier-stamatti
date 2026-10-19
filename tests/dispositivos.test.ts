import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { crearBaseDescartable } from "./helpers/base-descartable";

/**
 * A quién le llegan los avisos y a quién no.
 *
 * Al 18/10/2026 Aldana no tenía ningún dispositivo y nadie lo sabía: los
 * avisos de seis semanas se perdieron sin que ninguna pantalla lo dijera.
 */

const base = crearBaseDescartable("dispositivos");
let prisma: typeof import("../lib/db").prisma;
let disp: typeof import("../lib/dispositivos");

before(async () => {
  ({ prisma } = await import("../lib/db"));
  disp = await import("../lib/dispositivos");
});

after(async () => {
  await prisma?.$disconnect();
  base.borrar();
});

test("noLeLlega: tres fracasos seguidos sí, dos no, y uno bueno lo corta", () => {
  const f = { status: "ERROR" };
  const ok = { status: "ACEPTADO" };
  assert.equal(disp.noLeLlega([f, f, f]), true);
  assert.equal(disp.noLeLlega([f, f]), false);
  assert.equal(disp.noLeLlega([ok, f, f]), false);
  assert.equal(disp.noLeLlega([]), false);
});

test("primero quien no tiene ningún teléfono, después a quien no le llega, después el resto", async () => {
  const mk = (name: string, role: string) =>
    prisma.user.create({ data: { name, email: `${name}@t.local`, role, passwordHash: "x" } });
  const aldana = await mk("Aldana", "ARMADOR");
  const pablo = await mk("Pablo", "LOGISTICA");
  const enrique = await mk("Enrique", "ARMADOR");
  await mk("Contable", "PAGOS"); // rol retirado: no aparece

  const subPablo = await prisma.pushSubscription.create({
    data: {
      userId: pablo.id,
      endpoint: "https://fcm.googleapis.com/fcm/send/p",
      p256dh: "k",
      auth: "a",
      userAgent: "Mozilla/5.0 (Linux; Android 14) Chrome/130",
    },
  });
  const subEnrique = await prisma.pushSubscription.create({
    data: { userId: enrique.id, endpoint: "https://fcm.googleapis.com/fcm/send/e", p256dh: "k", auth: "a" },
  });
  for (let i = 0; i < 3; i++) {
    await prisma.pushDelivery.create({
      data: { userId: pablo.id, subscriptionId: subPablo.id, kind: "ORDER_EDIT", status: "ERROR", payload: "{}" },
    });
  }
  await prisma.pushDelivery.create({
    data: { userId: enrique.id, subscriptionId: subEnrique.id, kind: "ORDER_EDIT", status: "ACEPTADO", payload: "{}" },
  });

  const r = await disp.estadoDeDispositivos();
  assert.deepEqual(r.map((p) => p.name), ["Aldana", "Pablo", "Enrique"]);
  assert.equal(r[0].dispositivos.length, 0);
  assert.equal(r[1].dispositivos[0].noLeLlega, true);
  assert.equal(r[1].dispositivos[0].descripcion, "Chrome · Android");
  assert.equal(r[2].dispositivos[0].noLeLlega, false);
  assert.equal(r[2].dispositivos[0].descripcion, "Desconocido", "sin userAgent todavía");
  assert.equal(r.some((p) => p.id === aldana.id), true);
});

// Los envíos se crean con `createdAt` explícito: sin eso, todos caen en el mismo
// instante y la prueba no distingue "del más nuevo al más viejo" del revés.
const haceDias = (d: number) => new Date(Date.now() - d * 24 * 60 * 60 * 1000);
const haceUnaHora = () => new Date(Date.now() - 60 * 60 * 1000);

async function dispositivoConEnvios(
  nombre: string,
  envios: { status: string; createdAt: Date; attempt?: number; retriedAt?: Date }[],
) {
  const u = await prisma.user.create({
    data: { name: nombre, email: `${nombre}@t.local`, role: "ARMADOR", passwordHash: "x" },
  });
  const s = await prisma.pushSubscription.create({
    data: { userId: u.id, endpoint: `https://fcm.googleapis.com/fcm/send/${nombre}`, p256dh: "k", auth: "a" },
  });
  for (const e of envios) {
    await prisma.pushDelivery.create({
      data: { userId: u.id, subscriptionId: s.id, kind: "ORDER_EDIT", payload: "{}", ...e },
    });
  }
  const persona = (await disp.estadoDeDispositivos()).find((p) => p.id === u.id);
  assert.ok(persona, `${nombre} tiene que aparecer`);
  return persona.dispositivos[0];
}

test("cuenta del más nuevo al más viejo: tres errores viejos y uno aceptado reciente SÍ le llega", async () => {
  const d = await dispositivoConEnvios("Viejos", [
    { status: "ERROR", createdAt: haceDias(4) },
    { status: "ERROR", createdAt: haceDias(3) },
    { status: "ERROR", createdAt: haceDias(2) },
    { status: "ACEPTADO", createdAt: haceUnaHora() },
  ]);
  assert.equal(d.noLeLlega, false);
});

test("cuenta del más nuevo al más viejo: uno aceptado viejo y tres errores recientes NO le llega", async () => {
  const d = await dispositivoConEnvios("Recientes", [
    { status: "ACEPTADO", createdAt: haceDias(4) },
    { status: "ERROR", createdAt: haceDias(3) },
    { status: "ERROR", createdAt: haceDias(2) },
    { status: "ERROR", createdAt: haceUnaHora() },
  ]);
  assert.equal(d.noLeLlega, true);
});

// El reintento (attempt 2) es otra fila del mismo envío, un minuto después, y
// `reintentarFallidos` le pone `retriedAt` al primer intento ANTES de reenviar.
const unMinutoDespues = (d: Date) => new Date(d.getTime() + 60_000);

test("el reintento no es otro envío: dos envíos reales, uno con su reintento fallido, no alcanzan", async () => {
  // Envío A: primer intento fallido + su reintento fallido. Envío B: fallido.
  // Tres filas fallidas, pero solo dos envíos reales.
  const a = haceDias(2);
  const d = await dispositivoConEnvios("Reintento", [
    { status: "ERROR", createdAt: a, attempt: 1, retriedAt: unMinutoDespues(a) },
    { status: "ERROR", createdAt: unMinutoDespues(a), attempt: 2 },
    { status: "ERROR", createdAt: haceUnaHora(), attempt: 1 },
  ]);
  assert.equal(d.noLeLlega, false);
});

test("cada envío cuenta por cómo terminó: tres primeros intentos fallidos que el reintento salvó SÍ le llegan", async () => {
  // Es el caso que la pantalla no puede contradecir: lastOkAt está fresco.
  const envios = [haceDias(3), haceDias(2), haceUnaHora()].flatMap((t) => [
    { status: "ERROR", createdAt: t, attempt: 1, retriedAt: unMinutoDespues(t) },
    { status: "ACEPTADO", createdAt: unMinutoDespues(t), attempt: 2 },
  ]);
  const d = await dispositivoConEnvios("Salvados", envios);
  assert.equal(d.noLeLlega, false);
});

test("cada envío cuenta por cómo terminó: tres envíos cuyo reintento también falló NO le llegan", async () => {
  const envios = [haceDias(3), haceDias(2), haceUnaHora()].flatMap((t) => [
    { status: "ERROR", createdAt: t, attempt: 1, retriedAt: unMinutoDespues(t) },
    { status: "ERROR", createdAt: unMinutoDespues(t), attempt: 2 },
  ]);
  const d = await dispositivoConEnvios("Perdidos", envios);
  assert.equal(d.noLeLlega, true);
});

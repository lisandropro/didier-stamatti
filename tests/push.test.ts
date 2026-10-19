import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { crearBaseDescartable } from "./helpers/base-descartable";

/**
 * El registro de cada push, contra una base de verdad.
 *
 * Lo que se protege: que ningún envío se pierda en silencio. Del 07/09 al
 * 19/10/2026 ningún teléfono pudo activar los avisos y nada lo mostró.
 *
 * El envío real se reemplaza por uno falso (`transporte`) que responde el
 * código que pide cada prueba: así se prueban los seis desenlaces sin red.
 */

const base = crearBaseDescartable("push");
let prisma: typeof import("../lib/db").prisma;
let push: typeof import("../lib/push");
let usuario = "";
let otro = "";
let respuesta: number | "red" = 201;
const cuerpos: string[] = [];

before(async () => {
  ({ prisma } = await import("../lib/db"));
  push = await import("../lib/push");
  push.transporte.listo = () => true;
  push.transporte.enviar = async (_destino, cuerpo) => {
    cuerpos.push(cuerpo);
    if (respuesta === "red") throw new Error("socket hang up");
    if (respuesta >= 200 && respuesta < 300) return { statusCode: respuesta };
    throw Object.assign(new Error(`Received unexpected response code ${respuesta}`), { statusCode: respuesta });
  };
  const u = await prisma.user.create({ data: { name: "Pablo", email: "p@test.local", role: "LOGISTICA", passwordHash: "x" } });
  const o = await prisma.user.create({ data: { name: "Enrique", email: "e@test.local", role: "ARMADOR", passwordHash: "x" } });
  usuario = u.id;
  otro = o.id;
});

after(async () => {
  await prisma?.$disconnect();
  base.borrar();
});

beforeEach(async () => {
  await prisma.pushDelivery.deleteMany({});
  await prisma.pushSubscription.deleteMany({});
  cuerpos.length = 0;
  respuesta = 201;
  push.transporte.listo = () => true;
});

const suscribir = (userId: string, sufijo: string) =>
  prisma.pushSubscription.create({
    data: { userId, endpoint: `https://fcm.googleapis.com/fcm/send/${sufijo}`, p256dh: "k", auth: "a" },
  });

const PAYLOAD = { title: "El Carmen Center", body: "Copa de agua 10→24", url: "/aviso/x", tag: "order-x" };

test("clasificar: cada código cae donde corresponde", () => {
  assert.deepEqual(push.clasificar(201), { status: "ACEPTADO", reintentable: false });
  assert.deepEqual(push.clasificar(404), { status: "CADUCADO", reintentable: false });
  assert.deepEqual(push.clasificar(410), { status: "CADUCADO", reintentable: false });
  assert.deepEqual(push.clasificar(403), { status: "RECHAZADO", reintentable: false });
  assert.deepEqual(push.clasificar(413), { status: "RECHAZADO", reintentable: false });
  assert.deepEqual(push.clasificar(429), { status: "ERROR", reintentable: true });
  assert.deepEqual(push.clasificar(503), { status: "ERROR", reintentable: true });
  assert.deepEqual(push.clasificar(null), { status: "ERROR", reintentable: true });
});

test("un envío aceptado queda registrado y marca el dispositivo", async () => {
  const sub = await suscribir(usuario, "a1");
  const r = await push.sendPushToUser(usuario, PAYLOAD, { kind: "ORDER_EDIT", notificationId: "n1" });
  assert.deepEqual(r, { intentos: 1, aceptados: 1 });
  const [e] = await prisma.pushDelivery.findMany();
  assert.equal(e.status, "ACEPTADO");
  assert.equal(e.notificationId, "n1");
  assert.equal(e.subscriptionId, sub.id);
  assert.equal(e.kind, "ORDER_EDIT");
  assert.ok((await prisma.pushSubscription.findUnique({ where: { id: sub.id } }))?.lastOkAt);
});

test("lo que llega al teléfono lleva la marca de entrega, y lo guardado no", async () => {
  await suscribir(usuario, "a2");
  await push.sendPushToUser(usuario, PAYLOAD, { kind: "ORDER_EDIT" });
  const [e] = await prisma.pushDelivery.findMany();
  assert.equal(JSON.parse(cuerpos[0]).d, e.id, "el service worker necesita el id para avisar que se abrió");
  assert.equal(JSON.parse(e.payload).d, undefined, "el reintento tiene que generar su propia marca");
});

test("404 y 410: el dispositivo caducó y se borra", async () => {
  await suscribir(usuario, "c1");
  respuesta = 410;
  const r = await push.sendPushToUser(usuario, PAYLOAD, { kind: "ORDER_EDIT" });
  assert.equal(r.aceptados, 0);
  assert.equal((await prisma.pushDelivery.findFirst())?.status, "CADUCADO");
  assert.equal(await prisma.pushSubscription.count(), 0);
});

test("403: rechazado, no se reintenta y el dispositivo queda", async () => {
  const sub = await suscribir(usuario, "r1");
  respuesta = 403;
  await push.sendPushToUser(usuario, PAYLOAD, { kind: "ORDER_EDIT" });
  const e = await prisma.pushDelivery.findFirst();
  assert.equal(e?.status, "RECHAZADO");
  assert.equal(e?.reintentable, false);
  assert.ok((await prisma.pushSubscription.findUnique({ where: { id: sub.id } }))?.lastErrorAt);
  assert.equal(await push.reintentarFallidos(), 0);
});

test("500: se reintenta UNA vez, y nunca más", async () => {
  await suscribir(usuario, "e1");
  respuesta = 500;
  await push.sendPushToUser(usuario, PAYLOAD, { kind: "ORDER_EDIT" }, { urgency: "high" });
  respuesta = 201;
  assert.equal(await push.reintentarFallidos(), 1);
  const intentos = await prisma.pushDelivery.findMany({ orderBy: { attempt: "asc" } });
  assert.deepEqual(intentos.map((i) => [i.attempt, i.status]), [[1, "ERROR"], [2, "ACEPTADO"]]);
  assert.equal(intentos[1].urgency, "high", "el reintento conserva la prioridad");
  assert.equal(await push.reintentarFallidos(), 0, "un segundo barrido no reintenta de nuevo");
});

test("sin red: error reintentable, sin código", async () => {
  await suscribir(usuario, "n1");
  respuesta = "red";
  await push.sendPushToUser(usuario, PAYLOAD, { kind: "ORDER_EDIT" });
  const e = await prisma.pushDelivery.findFirst();
  assert.equal(e?.status, "ERROR");
  assert.equal(e?.statusCode, null);
  assert.equal(e?.reintentable, true);
  assert.match(e?.error ?? "", /socket hang up/);
});

test("un intento viejo de más de una hora no se reintenta", async () => {
  await suscribir(usuario, "v1");
  respuesta = 500;
  await push.sendPushToUser(usuario, PAYLOAD, { kind: "ORDER_EDIT" });
  const dentroDeDosHoras = new Date(Date.now() + 2 * 60 * 60 * 1000);
  assert.equal(await push.reintentarFallidos(dentroDeDosHoras), 0);
});

test("sin claves VAPID: queda registrado como error y no se reintenta", async () => {
  await suscribir(usuario, "s1");
  push.transporte.listo = () => false;
  const r = await push.sendPushToUser(usuario, PAYLOAD, { kind: "SISTEMA" });
  assert.equal(r.aceptados, 0);
  const e = await prisma.pushDelivery.findFirst();
  assert.equal(e?.status, "ERROR");
  assert.equal(e?.error, "sin claves");
  assert.equal(e?.reintentable, false);
  assert.equal(cuerpos.length, 0, "no tiene que intentar mandar nada");
});

test("una persona sin dispositivos no genera registro ni error", async () => {
  const r = await push.sendPushToUser(usuario, PAYLOAD, { kind: "ORDER_EDIT" });
  assert.deepEqual(r, { intentos: 0, aceptados: 0 });
});

test("abrir el aviso marca la entrega y deja leído el aviso; otra persona no puede", async () => {
  await suscribir(usuario, "o1");
  const ev = await prisma.notification.create({
    data: { recipientId: usuario, actorName: "Sistema", type: "PEDIDO_VACIO:x:1", message: "m", pushedAt: new Date() },
  });
  await push.sendPushToUser(usuario, PAYLOAD, { kind: "PEDIDO_VACIO", notificationId: ev.id });
  const e = (await prisma.pushDelivery.findFirst())!;
  assert.equal(await push.registrarApertura(otro, e.id), false);
  assert.equal((await prisma.pushDelivery.findUnique({ where: { id: e.id } }))?.openedAt, null);
  assert.equal(await push.registrarApertura(usuario, e.id), true);
  assert.ok((await prisma.pushDelivery.findUnique({ where: { id: e.id } }))?.openedAt);
  assert.equal((await prisma.notification.findUnique({ where: { id: ev.id } }))?.read, true);
});

test("la prueba va solo al teléfono que la pide", async () => {
  await suscribir(usuario, "t1");
  await suscribir(usuario, "t2");
  const r = await push.enviarPrueba(usuario, "https://fcm.googleapis.com/fcm/send/t2");
  assert.deepEqual(r, { ok: true });
  assert.equal(cuerpos.length, 1);
  assert.equal((await prisma.pushDelivery.findFirst())?.kind, "PRUEBA");
});

test("la prueba no sale a un teléfono de otra persona", async () => {
  await suscribir(otro, "ajeno");
  const r = await push.enviarPrueba(usuario, "https://fcm.googleapis.com/fcm/send/ajeno");
  assert.equal(r.ok, false);
  assert.equal(cuerpos.length, 0);
});

test("la poda borra lo de más de 60 días y nada más", async () => {
  const vieja = new Date(Date.now() - 61 * 24 * 60 * 60 * 1000);
  await prisma.pushDelivery.create({
    data: { userId: usuario, kind: "ORDER_EDIT", status: "ACEPTADO", payload: "{}", createdAt: vieja },
  });
  await prisma.pushDelivery.create({ data: { userId: usuario, kind: "ORDER_EDIT", status: "ACEPTADO", payload: "{}" } });
  assert.equal(await push.podarEntregas(), 1);
  assert.equal(await prisma.pushDelivery.count(), 1);
});

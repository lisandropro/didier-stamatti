import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { crearBaseDescartable } from "./helpers/base-descartable";
import { instanteDe, sumarDias } from "../lib/dates";

/**
 * El resumen de la mañana contra una base de verdad: a quién le llega, a qué
 * hora, una sola vez por día, y qué eventos cuentan. El texto en sí se prueba
 * aparte (`resumen-manana.test.ts`); acá se prueba que esté bien conectado.
 *
 * Las pruebas se van armando una sobre otra, como en `faltantes-db.test.ts`:
 * el día 1 manda, el día 2 vuelve a mandar, y los días siguientes son casos
 * sueltos con sus propios eventos.
 */

const base = crearBaseDescartable("resumen-manana-db");
let prisma: typeof import("../lib/db").prisma;
let enviarResumen: typeof import("../lib/resumen-manana-db").enviarResumenDeLaManana;
const enviados: { title: string; body: string; url?: string; tag?: string; endpoint: string }[] = [];
let ids: { periodo: string; ana: string; pablo: string; dante: string; enrique: string; zoe: string };

// Un martes cualquiera. Todo se fecha respecto de este día, no del reloj.
const D1 = "2026-11-10";
const D2 = sumarDias(D1, 1);
const D3 = sumarDias(D1, 2);
const a = (dia: string, hora: string) => instanteDe(dia, hora);

before(async () => {
  ({ prisma } = await import("../lib/db"));
  enviarResumen = (await import("../lib/resumen-manana-db")).enviarResumenDeLaManana;
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
  // Enrique es el único sin teléfono: es a quien la administradora tiene que ver en "Sin avisos".
  const enrique = await mk("Enrique", "ARMADOR");
  // Un rol que ya no existe en la app: no recibe nada ni cuenta como "sin avisos".
  const zoe = await mk("Zoe", "EX_ROL");
  for (const u of [ana, pablo, dante]) {
    await prisma.pushSubscription.create({ data: { userId: u.id, endpoint: `https://fcm.googleapis.com/fcm/send/${u.name}`, p256dh: "k", auth: "a" } });
  }
  const periodo = await prisma.operationalPeriod.create({ data: { label: "Semana", startDay: D1, endDay: D3 } });
  const copa = await prisma.product.create({ data: { name: "Copa de agua", category: "ENSERES", type: "REUTILIZABLE", stock: 250 } });
  const mk2 = (lugar: string, date: Date, status = "NO_LISTO") => prisma.event.create({ data: { periodId: periodo.id, lugar, date, status } });
  // Hoy: con pedido que pasa el stock (falta 1 producto), sin marcar listo.
  const elCarmen = await mk2("El Carmen", a(D1, "21:00"));
  await prisma.orderLine.create({ data: { eventId: elCarmen.id, productId: copa.id, qty: 300 } });
  // Mañana: uno sin pedido y uno con pedido y listo.
  await mk2("Puerto", a(D2, "12:00"));
  const quinta = await mk2("Quinta", a(D2, "20:00"), "LISTO");
  await prisma.orderLine.create({ data: { eventId: quinta.id, customName: "Mantel", qty: 5 } });
  // Los bordes: la última hora de ayer y la primera de pasado mañana no son ni hoy ni mañana.
  await mk2("Ayer", a(sumarDias(D1, -1), "23:59"));
  await mk2("Pasado", a(D3, "00:00"));
  ids = { periodo: periodo.id, ana: ana.id, pablo: pablo.id, dante: dante.id, enrique: enrique.id, zoe: zoe.id };
});

after(async () => {
  await prisma?.$disconnect();
  base.borrar();
});

const avisosDe = (userId: string, dia: string) => prisma.notification.findMany({ where: { recipientId: userId, type: `RESUMEN:${dia}` } });
const total = (dia: string) => prisma.notification.count({ where: { type: `RESUMEN:${dia}` } });

test("antes de las 7 no manda nada", async () => {
  const r = await enviarResumen(a(D1, "06:59"));
  assert.deepEqual(r, { enviados: 0 });
  assert.equal(await total(D1), 0);
  assert.equal(enviados.length, 0);
});

test("a las 7:05 manda uno a cada persona con rol vigente, con lo suyo y los prioritarios primero", async () => {
  const r = await enviarResumen(a(D1, "07:05"));
  assert.equal(r.enviados, 4, "Ana, Pablo, Dante y Enrique; Zoe no tiene un rol vigente");
  assert.equal(await total(D1), 4);
  assert.equal((await avisosDe(ids.zoe, D1)).length, 0);

  // Los avisos de la app: uno por persona, con su texto y su destino.
  const deDante = (await avisosDe(ids.dante, D1))[0];
  assert.equal(deDante.message, "Hoy: El Carmen\nMañana: Puerto y Quinta\nFalta 1 producto en el depósito.");
  assert.equal(deDante.actorName, "Sistema");
  assert.equal(deDante.linkUrl, "/preparar", "al tocarlo en Avisos va a Preparar");
  assert.ok(deDante.pushedAt, "nace marcado como enviado: ningún barrido lo vuelve a mandar");
  assert.equal(deDante.read, false);
  const deEnrique = (await avisosDe(ids.enrique, D1))[0];
  assert.equal(deEnrique.message, "Hoy: El Carmen\nMañana: Puerto y Quinta\nSin pedido: 1 · Sin marcar listo: 1\nFalta 1 producto en el depósito.");
  assert.equal(deEnrique.linkUrl, "/");
  assert.equal((await avisosDe(ids.pablo, D1))[0].linkUrl, "/");

  // Los push: solo para quien tiene teléfono, y quien sale a conseguir las cosas primero.
  assert.equal(enviados.length, 3, "Ana, Pablo y Dante tienen teléfono; Enrique no");
  assert.deepEqual(
    enviados.slice(0, 2).map((p) => p.endpoint.split("/").pop()).sort(),
    ["Dante", "Pablo"],
    "el depósito y logística primero",
  );
  assert.ok(enviados[2].endpoint.endsWith("Ana"));
  for (const p of enviados) {
    assert.equal(p.title, "Hoy y mañana");
    assert.equal(p.tag, `resumen-${D1}`);
  }
  const push = (quien: string) => enviados.find((p) => p.endpoint.endsWith(quien))!;
  assert.equal(push("Dante").url, "/preparar", "el depósito va a Preparar");
  assert.equal(push("Pablo").url, "/");
  assert.equal(push("Ana").url, "/", "quien arma pedidos va al inicio");
  assert.equal(push("Dante").body, deDante.message);

  const entregas = await prisma.pushDelivery.findMany({ where: { kind: "RESUMEN" } });
  assert.equal(entregas.length, 3);
  assert.ok(entregas.every((e) => e.urgency === "normal" && e.notificationId !== null), "urgencia normal y ligado a su aviso");
});

test("la administradora ve quién no tiene los avisos activados, y nadie más", async () => {
  const deAna = (await avisosDe(ids.ana, D1))[0];
  assert.match(deAna.message, /Sin avisos en el celular: Enrique$/, "solo Enrique, no Zoe que ya no tiene rol");
  const otros = (await prisma.notification.findMany({ where: { type: `RESUMEN:${D1}`, recipientId: { not: ids.ana } } })).map((n) => n.message);
  assert.equal(otros.length, 3);
  assert.ok(otros.every((m) => !m.includes("Sin avisos")));
});

test("hoy y mañana son los días argentinos: ni ayer a la noche ni pasado mañana a las 0", async () => {
  const m = (await avisosDe(ids.dante, D1))[0].message;
  assert.doesNotMatch(m, /Ayer|Pasado/);
});

test("correrlo otra vez el mismo día no manda dos", async () => {
  enviados.length = 0;
  assert.deepEqual(await enviarResumen(a(D1, "07:35")), { enviados: 0 });
  assert.deepEqual(await enviarResumen(a(D1, "10:59")), { enviados: 0 });
  assert.equal(await total(D1), 4);
  assert.equal(enviados.length, 0);
});

test("al día siguiente vuelve a mandar", async () => {
  const r = await enviarResumen(a(D2, "07:05"));
  assert.equal(r.enviados, 4);
  assert.equal(await total(D2), 4);
  assert.equal(await total(D1), 4, "el del día anterior no se toca");
  const m = (await avisosDe(ids.dante, D2))[0].message;
  assert.match(m, /^Hoy: Puerto y Quinta\nMañana: Pasado/, "ahora Puerto y Quinta son de hoy y Pasado es de mañana");
});

test("a las 11 o después no manda, aunque ese día no haya salido", async () => {
  enviados.length = 0;
  assert.deepEqual(await enviarResumen(a(D3, "11:00")), { enviados: 0 });
  assert.deepEqual(await enviarResumen(a(D3, "11:30")), { enviados: 0 });
  assert.deepEqual(await enviarResumen(a(D3, "18:00")), { enviados: 0 });
  assert.equal(await total(D3), 0);
  assert.equal(enviados.length, 0);
});

test("sin eventos hoy ni mañana no manda", async () => {
  enviados.length = 0;
  const vacio = sumarDias(D1, 30);
  assert.deepEqual(await enviarResumen(a(vacio, "07:05")), { enviados: 0 });
  assert.equal(await total(vacio), 0);
  assert.equal(enviados.length, 0);
});

test("un evento en la papelera, o de un período en la papelera, no cuenta", async () => {
  enviados.length = 0;
  const dia = sumarDias(D1, 40);
  const vivo = await prisma.operationalPeriod.create({ data: { label: "Vivo", startDay: dia, endDay: dia } });
  const borrado = await prisma.operationalPeriod.create({ data: { label: "Borrado", startDay: dia, endDay: dia, deletedAt: new Date() } });
  await prisma.event.create({ data: { periodId: vivo.id, lugar: "Evento borrado", date: a(dia, "12:00"), deletedAt: new Date() } });
  await prisma.event.create({ data: { periodId: borrado.id, lugar: "Período borrado", date: a(dia, "13:00") } });
  assert.deepEqual(await enviarResumen(a(dia, "07:05")), { enviados: 0 }, "solo hay cosas en la papelera: no hay nada que resumir");
  assert.equal(await total(dia), 0);

  // Con un evento vivo sí manda, y solo nombra al vivo.
  await prisma.event.create({ data: { periodId: vivo.id, lugar: "Evento vivo", date: a(dia, "14:00") } });
  assert.equal((await enviarResumen(a(dia, "07:10"))).enviados, 4);
  const m = (await avisosDe(ids.dante, dia))[0].message;
  assert.match(m, /^Hoy: Evento vivo\nMañana no hay eventos\./);
  assert.doesNotMatch(m, /borrado/i);
});

test("dos corridas a la vez no mandan dos veces", async () => {
  enviados.length = 0;
  const dia = sumarDias(D1, 50);
  const p = await prisma.operationalPeriod.create({ data: { label: "Simultáneo", startDay: dia, endDay: dia } });
  await prisma.event.create({ data: { periodId: p.id, lugar: "Costanera", date: a(dia, "12:00") } });
  const [x, y] = await Promise.all([enviarResumen(a(dia, "07:05")), enviarResumen(a(dia, "07:05"))]);
  assert.equal(x.enviados + y.enviados, 4);
  assert.equal(await total(dia), 4, "una por persona, no ocho");
  assert.equal(enviados.length, 3);
});

test("nunca lanza: si la base falla, lo anota y devuelve lo enviado hasta ahí", async () => {
  const dia = sumarDias(D1, 60);
  const original = prisma.event.findMany;
  const errores: unknown[][] = [];
  const consolaOriginal = console.error;
  console.error = (...args: unknown[]) => void errores.push(args);
  (prisma.event as { findMany: unknown }).findMany = async () => {
    throw new Error("la base se cayó");
  };
  try {
    assert.deepEqual(await enviarResumen(a(dia, "07:05")), { enviados: 0 });
  } finally {
    (prisma.event as { findMany: unknown }).findMany = original;
    console.error = consolaOriginal;
  }
  assert.equal(errores.length, 1);
  assert.match(String(errores[0][0]), /^\[resumen\]/);
  // Y la corrida siguiente no quedó trabada por la anterior.
  const p = await prisma.operationalPeriod.create({ data: { label: "Después", startDay: dia, endDay: dia } });
  await prisma.event.create({ data: { periodId: p.id, lugar: "Después del error", date: a(dia, "12:00") } });
  assert.equal((await enviarResumen(a(dia, "07:10"))).enviados, 4);
});

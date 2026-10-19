import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { instanteDe } from "../lib/dates";

/**
 * El agrupamiento de avisos, contra una base de verdad.
 *
 * Se prueba acá y no a mano porque la regla es fácil de romper sin darse cuenta:
 * "un solo aviso por tanda, dos minutos después del último cambio" depende de
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
const enviadosAlTelefono: { title: string; body: string; url?: string }[] = [];

before(async () => {
  fs.rmSync(DB, { force: true });
  // Prisma en Windows necesita que el archivo SQLite exista antes de migrar.
  fs.writeFileSync(DB, "");
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
  // El envío real se reemplaza: el barrido cuenta lo que ACEPTA el servicio de
  // push, así que estas pruebas necesitan dispositivos y un transporte que acepte.
  const push = await import("../lib/push");
  push.transporte.listo = () => true;
  push.transporte.enviar = async (_destino, cuerpo) => {
    enviadosAlTelefono.push(JSON.parse(cuerpo));
    return { statusCode: 201 };
  };

  const mk = (name: string, role: string) =>
    prisma.user.create({ data: { name, email: `${role}@test.local`, role, passwordHash: "x" } });
  const admin = await mk("Ana", "ADMIN");
  const logistica = await mk("Pablo", "LOGISTICA");
  const armador = await mk("Enrique", "ARMADOR");
  // Período operativo: días de calendario como texto, sin hora. El evento sí es
  // un instante, y se arma con la hora de pared argentina (21hs del 15).
  const periodo = await prisma.operationalPeriod.create({
    data: { label: "Prueba", startDay: "2026-08-15", endDay: "2026-08-16" },
  });
  const ev = await prisma.event.create({
    data: {
      periodId: periodo.id,
      lugar: "El Carmen Center",
      date: instanteDe("2026-08-15", "21:00"),
      guests: 100,
    },
  });
  ids = { admin: admin.id, logistica: logistica.id, armador: armador.id, evento: ev.id };

  for (const [userId, sufijo] of [[logistica.id, "pablo"], [armador.id, "enrique"]] as const) {
    await prisma.pushSubscription.create({
      data: { userId, endpoint: `https://fcm.googleapis.com/fcm/send/${sufijo}`, p256dh: "k", auth: "a" },
    });
  }
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

/**
 * Simula que pasaron los minutos de quietud: corre hacia atrás TODAS las marcas
 * de tiempo juntas (aviso y cambios), como si el reloj hubiera avanzado.
 *
 * Tiene que ser así porque en producción la última actividad del aviso
 * (`createdAt`) y el último cambio guardado llevan la misma marca, y el
 * resumen de la tanda (`cambiosDeLaTanda`) se apoya en eso. Mover solo el aviso
 * dejaba los cambios "en el futuro" del aviso y el resumen salía vacío.
 */
async function pasaronMinutos(n: number) {
  const atras = (d: Date) => new Date(d.getTime() - n * 60 * 1000);
  for (const a of await prisma.notification.findMany()) {
    await prisma.notification.update({
      where: { id: a.id },
      data: {
        createdAt: atras(a.createdAt),
        sinceAt: atras(a.sinceAt),
        pushedAt: a.pushedAt ? atras(a.pushedAt) : null,
      },
    });
  }
  for (const c of await prisma.orderChange.findMany()) {
    await prisma.orderChange.update({ where: { id: c.id }, data: { createdAt: atras(c.createdAt) } });
  }
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

test("un usuario con un rol retirado no recibe avisos de pedidos", async () => {
  // Antes le llegaba a cualquier usuario menos al autor, incluidos los roles del
  // módulo financiero, que ni veían el pedido del que se les avisaba.
  const viejo = await prisma.user.create({
    data: { name: "Contable", email: "pagos@test.local", role: "PAGOS", passwordHash: "x" },
  });
  try {
    await notify.notifyOrderChange(ACTOR(), ids.evento, { itemName: "Hielo", kind: "AGREGADO", before: null, after: "20" });
    assert.equal((await avisos(viejo.id)).length, 0);
    assert.ok((await avisos(ids.logistica)).length > 0, "tampoco le llegó a logística: la prueba no prueba nada");
  } finally {
    await prisma.user.delete({ where: { id: viejo.id } });
  }
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

test("pasados los 2 minutos de quietud sale un push por persona", async () => {
  await pasaronMinutos(3);
  const r = await notify.flushPendingOrderPushes();
  assert.equal(r.enviados, 2);
});

test("el push dice qué cambió, no cuántas veces se tocó", () => {
  // La tanda tiene 5 cambios: los 4 de "cuatro cambios seguidos" más el Hielo
  // que suma la prueba de "un usuario con un rol retirado".
  const ultimo = enviadosAlTelefono.at(-1)!;
  assert.equal(ultimo.title, "El Carmen Center");
  assert.equal(ultimo.body, "Copa de agua 10→24 · Servilletas +50 · Brasero quitado · y 2 más\n— Ana");
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

test("'Qué cambió' de una tanda vieja no muestra los cambios de la siguiente", async () => {
  // `avisos` ordena del más nuevo al más viejo: [tanda nueva, tanda vieja].
  const [, vieja] = await avisos(ids.logistica);
  const cambios = await notify.cambiosDeLaTanda(vieja);
  assert.equal(cambios.length, 5, "se coló el cambio de la tanda nueva");
  assert.equal(cambios.some((x) => x.itemName === "Fuente"), false);
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

test("si los cambios se compensaron, el teléfono no suena", async () => {
  await limpiar();
  const antes = enviadosAlTelefono.length;
  await notify.notifyOrderChange(ACTOR(), ids.evento, { itemName: "Hielo", kind: "AGREGADO", before: null, after: "20" });
  await notify.notifyOrderChange(ACTOR(), ids.evento, { itemName: "Hielo", kind: "QUITADO", before: "20", after: null });
  await pasaronMinutos(3);
  const r = await notify.flushPendingOrderPushes();
  assert.equal(r.cerrados, 2, "las tandas se cierran igual");
  assert.equal(r.enviados, 0);
  assert.equal(enviadosAlTelefono.length, antes);
});

const HIELO = { itemName: "Hielo", kind: "AGREGADO" as const, before: null, after: "20" };

test("antes de los 2 minutos de quietud no sale nada; pasados, sí", async () => {
  await limpiar();
  await notify.notifyOrderChange(ACTOR(), ids.evento, HIELO);
  await pasaronMinutos(1.5);
  const antes = await notify.flushPendingOrderPushes();
  assert.equal(antes.cerrados, 0, "a 1,5 minutos todavía puede estar editando");
  assert.equal(antes.enviados, 0);
  await pasaronMinutos(1); // 2,5 en total
  const despues = await notify.flushPendingOrderPushes();
  assert.equal(despues.cerrados, 2);
  assert.equal(despues.enviados, 2);
});

test("si el servicio de push no acepta, no cuenta como enviado pero la tanda se cierra", async () => {
  await limpiar();
  const push = await import("../lib/push");
  const aceptando = push.transporte.enviar;
  push.transporte.enviar = async () => {
    throw Object.assign(new Error("el servicio de push está caído"), { statusCode: 500 });
  };
  try {
    await notify.notifyOrderChange(ACTOR(), ids.evento, HIELO);
    await pasaronMinutos(3);
    const r = await notify.flushPendingOrderPushes();
    assert.equal(r.enviados, 0, "un envío no aceptado no cuenta");
    assert.equal(r.cerrados, 2);
    assert.equal(await prisma.notification.count({ where: { type: "ORDER_EDIT", pushedAt: null } }), 0);
    // El fallo no se pierde: queda en el registro de envíos.
    assert.equal(await prisma.pushDelivery.count({ where: { status: "ERROR", attempt: 1 } }), 2);
  } finally {
    push.transporte.enviar = aceptando;
  }
  // Lo que falló por algo pasajero se reintenta en el barrido siguiente.
  const r2 = await notify.flushPendingOrderPushes();
  assert.equal(r2.reintentos, 2);
});

test("una tanda que crece mientras se manda no se cierra y sale con todos sus cambios", async () => {
  await limpiar();
  const push = await import("../lib/push");
  const aceptando = push.transporte.enviar;
  let alguienTocoElPedido = false;
  push.transporte.enviar = async (destino, cuerpo, urgency) => {
    if (!alguienTocoElPedido) {
      // Un cambio nuevo llega a mitad del barrido, cuando ya se leyó la tanda.
      alguienTocoElPedido = true;
      await notify.notifyOrderChange(ACTOR(), ids.evento, { itemName: "Vasos", kind: "CANTIDAD", before: "1", after: "2" });
    }
    return aceptando(destino, cuerpo, urgency);
  };
  try {
    await notify.notifyOrderChange(ACTOR(), ids.evento, HIELO);
    await pasaronMinutos(3);
    const r = await notify.flushPendingOrderPushes();
    assert.equal(r.cerrados, 0, "las tandas crecieron: no se cierran");
    for (const quien of [ids.logistica, ids.armador]) {
      const [a] = await avisos(quien);
      assert.equal(a.pushedAt, null);
      assert.equal(a.changeCount, 2);
    }
  } finally {
    push.transporte.enviar = aceptando;
  }
  // Pasada la próxima quietud, sale con los dos cambios y ahí sí se cierra.
  await pasaronMinutos(3);
  const antes = enviadosAlTelefono.length;
  const r2 = await notify.flushPendingOrderPushes();
  assert.equal(r2.cerrados, 2);
  assert.equal(r2.enviados, 2);
  const nuevos = enviadosAlTelefono.slice(antes);
  assert.equal(nuevos.length, 2);
  assert.ok(nuevos.every((x) => x.body.includes("Hielo") && x.body.includes("Vasos")), "faltó un cambio en el push");
});

test("si falla la lectura para armar el texto, el aviso no se cierra y sale en el barrido siguiente", async () => {
  await limpiar();
  // El barrido lee con el cliente de lib/db, que no es el de esta prueba.
  const { prisma: base } = await import("../lib/db");
  const original = base.event.findUnique;
  const consoleError = console.error;
  const errores: string[] = [];

  // El cambio se guarda ANTES de romper la lectura: guardarlo también la usa.
  await notify.notifyOrderChange(ACTOR(), ids.evento, HIELO);
  await pasaronMinutos(3);

  base.event.findUnique = (async () => {
    throw new Error("database is locked");
  }) as unknown as typeof base.event.findUnique;
  console.error = (...args: unknown[]) => void errores.push(args.map(String).join(" "));
  try {
    const r = await notify.flushPendingOrderPushes();
    assert.equal(r.enviados, 0);
    assert.equal(r.cerrados, 0, "no se cierra lo que no se pudo avisar");
  } finally {
    base.event.findUnique = original;
    console.error = consoleError;
  }
  assert.equal(await prisma.notification.count({ where: { type: "ORDER_EDIT", pushedAt: null } }), 2);
  assert.equal(errores.filter((x) => x.includes("[avisos]") && x.includes("database is locked")).length, 2, errores.join("\n"));

  // Con la lectura repuesta, el barrido siguiente lo manda y lo cierra.
  const r2 = await notify.flushPendingOrderPushes();
  assert.equal(r2.enviados, 2);
  assert.equal(r2.cerrados, 2);
});

test("la última actividad de un aviso nunca retrocede", async () => {
  // Dos guardados de la misma persona desde dos aparatos pueden llegar
  // desordenados. Si `createdAt` retrocediera, el resumen de la tanda (que llega
  // hasta `createdAt`) dejaría afuera el cambio más nuevo.
  await limpiar();
  await notify.notifyOrderChange(ACTOR(), ids.evento, HIELO);
  const futuro = new Date(Date.now() + 60 * 1000);
  await prisma.notification.updateMany({ data: { createdAt: futuro } });
  await notify.notifyOrderChange(ACTOR(), ids.evento, { itemName: "Vasos", kind: "CANTIDAD", before: "1", after: "2" });
  const [a] = await avisos(ids.logistica);
  assert.equal(a.changeCount, 2);
  assert.equal(a.createdAt.getTime(), futuro.getTime());
});

test("un evento que no existe no rompe el guardado del pedido", async () => {
  await assert.doesNotReject(() =>
    notify.notifyOrderChange(ACTOR(), "id-que-no-existe", { itemName: "x", kind: "CANTIDAD", after: "1" })
  );
});

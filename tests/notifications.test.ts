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
// Cada push que "sale", con el teléfono al que iba: hay pruebas que necesitan
// saber a quién le llegó y a quién no.
const enviadosAlTelefono: { title: string; body: string; url?: string; tag?: string; endpoint: string }[] = [];
const TEL_PABLO = "https://fcm.googleapis.com/fcm/send/pablo";
const TEL_ENRIQUE = "https://fcm.googleapis.com/fcm/send/enrique";

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
  push.transporte.enviar = async (destino, cuerpo) => {
    enviadosAlTelefono.push({ ...JSON.parse(cuerpo), endpoint: destino.endpoint });
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

  for (const [userId, endpoint] of [[logistica.id, TEL_PABLO], [armador.id, TEL_ENRIQUE]] as const) {
    await prisma.pushSubscription.create({ data: { userId, endpoint, p256dh: "k", auth: "a" } });
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
  // El número sale del contador que quedó en la base después de sumar.
  assert.equal(a.message, "Ana hizo 4 cambios en el pedido de El Carmen Center");
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
  // Y el reintento llegó de verdad, no solo se intentó.
  const segundos = await prisma.pushDelivery.findMany({ where: { attempt: 2 } });
  assert.deepEqual(segundos.map((s) => s.status), ["ACEPTADO", "ACEPTADO"]);
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

/**
 * Reemplaza el envío mientras dura `f`: la primera vez que se manda algo, antes
 * de que salga, corre `aMitad` (un cambio que llega en medio del barrido). El
 * envío de siempre vuelve aunque la prueba falle.
 */
async function conCambioAMitadDelEnvio(aMitad: () => Promise<void>, f: () => Promise<void>) {
  const push = await import("../lib/push");
  const aceptando = push.transporte.enviar;
  let yaPaso = false;
  push.transporte.enviar = async (destino, cuerpo, urgency) => {
    if (!yaPaso) {
      yaPaso = true;
      await aMitad();
    }
    return aceptando(destino, cuerpo, urgency);
  };
  try {
    await f();
  } finally {
    push.transporte.enviar = aceptando;
  }
}

test("un cambio a mitad del barrido no le manda a los que siguen un push a medias", async () => {
  // A Pablo (va primero) se le está mandando "Hielo +20" cuando Ana suma Vasos.
  // A Enrique, que viene después, antes le salía igual "Hielo +20" solo.
  await limpiar();
  await notify.notifyOrderChange(ACTOR(), ids.evento, HIELO);
  await pasaronMinutos(3);
  const antes = enviadosAlTelefono.length;
  await conCambioAMitadDelEnvio(
    () => notify.notifyOrderChange(ACTOR(), ids.evento, { itemName: "Vasos", kind: "CANTIDAD", before: "1", after: "2" }),
    async () => {
      const r = await notify.flushPendingOrderPushes();
      assert.equal(r.cerrados, 0);
    },
  );
  assert.deepEqual(
    enviadosAlTelefono.slice(antes).map((x) => x.endpoint),
    [TEL_PABLO],
    "a Enrique le salió el push sin los Vasos",
  );

  // Pasada la próxima quietud, a los dos les llega la tanda entera.
  await pasaronMinutos(3);
  const medio = enviadosAlTelefono.length;
  const r2 = await notify.flushPendingOrderPushes();
  assert.equal(r2.cerrados, 2);
  assert.equal(r2.enviados, 2);
  const completos = enviadosAlTelefono.slice(medio);
  assert.deepEqual(completos.map((x) => x.endpoint).sort(), [TEL_ENRIQUE, TEL_PABLO].sort());
  for (const x of completos) assert.equal(x.body, "Hielo +20 · Vasos 1→2\n— Ana");
});

test("si un cambio a mitad del barrido deshace lo avisado, el teléfono que lo recibió se corrige", async () => {
  // A Pablo le llega "Hielo +20" y, mientras se le manda, Ana saca el hielo.
  // Antes: Enrique recibía "Hielo +20" igual, y el barrido siguiente no tenía
  // nada que mandar (los cambios se compensan), así que los dos teléfonos se
  // quedaban con un hielo que ya no había que preparar.
  await limpiar();
  await notify.notifyOrderChange(ACTOR(), ids.evento, HIELO);
  await pasaronMinutos(3);
  const antes = enviadosAlTelefono.length;
  await conCambioAMitadDelEnvio(
    () => notify.notifyOrderChange(ACTOR(), ids.evento, { itemName: "Hielo", kind: "QUITADO", before: "20", after: null }),
    async () => {
      const r = await notify.flushPendingOrderPushes();
      assert.equal(r.cerrados, 0);
    },
  );
  const viejos = enviadosAlTelefono.slice(antes);
  assert.deepEqual(viejos.map((x) => x.endpoint), [TEL_PABLO], "a Enrique le salió lo que ya se había deshecho");
  assert.equal(viejos[0].body, "Hielo +20\n— Ana");

  await pasaronMinutos(3);
  const medio = enviadosAlTelefono.length;
  const r2 = await notify.flushPendingOrderPushes();
  assert.equal(r2.cerrados, 2);
  const correcciones = enviadosAlTelefono.slice(medio);
  assert.equal(correcciones.length, 1, "solo se corrige a quien le llegó lo viejo");
  const [c] = correcciones;
  assert.equal(c.endpoint, TEL_PABLO);
  assert.equal(c.title, "El Carmen Center");
  assert.equal(c.body, "Sin cambios: lo avisado recién se deshizo\n— Ana");
  // El mismo tag es lo que hace que reemplace a "Hielo +20" en la pantalla.
  assert.equal(c.tag, viejos[0].tag);
  assert.equal(c.tag, `order-${ids.evento}`);
  // Queda en el registro como cualquier aviso de esa tanda, con la prioridad de logística.
  const [aviso] = await avisos(ids.logistica);
  const filas = await prisma.pushDelivery.findMany({ where: { notificationId: aviso.id } });
  assert.equal(filas.length, 2);
  assert.ok(filas.every((f) => f.kind === "ORDER_EDIT" && f.urgency === "high" && f.status === "ACEPTADO"));
});

test("una tanda que suma cambios sin que se corra la marca de tiempo tampoco se cierra", async () => {
  // La última actividad nunca va hacia atrás, así que un cambio puede sumar sin
  // mover `createdAt`. El contador sí sube siempre, y el cierre lo mira.
  await limpiar();
  await notify.notifyOrderChange(ACTOR(), ids.evento, HIELO);
  await pasaronMinutos(3);
  await conCambioAMitadDelEnvio(
    async () => {
      await prisma.notification.updateMany({ where: { type: "ORDER_EDIT" }, data: { changeCount: { increment: 1 } } });
    },
    async () => {
      const r = await notify.flushPendingOrderPushes();
      assert.equal(r.cerrados, 0);
    },
  );
  const [a] = await avisos(ids.logistica);
  assert.equal(a.pushedAt, null, "se cerró una tanda que había crecido");
});

test("un barrido no arranca mientras el anterior sigue mandando", async () => {
  // `setInterval` larga un barrido por minuto aunque el anterior no haya
  // terminado. Con el servicio de push lento, el segundo volvía a mandar las
  // mismas tandas todavía abiertas.
  await limpiar();
  await notify.notifyOrderChange(ACTOR(), ids.evento, HIELO);
  await pasaronMinutos(3);

  const push = await import("../lib/push");
  const aceptando = push.transporte.enviar;
  let soltar = () => {};
  const trabado = new Promise<void>((r) => (soltar = r));
  let avisarQueEmpezo = () => {};
  const empezo = new Promise<void>((r) => (avisarQueEmpezo = r));
  let llamadas = 0;
  // Solo el primer envío se traba: si el segundo barrido llegara a mandar, lo
  // haría al toque y la prueba lo vería en vez de quedarse colgada.
  push.transporte.enviar = async (destino, cuerpo, urgency) => {
    llamadas++;
    if (llamadas === 1) {
      avisarQueEmpezo();
      await trabado;
    }
    return aceptando(destino, cuerpo, urgency);
  };
  let primero: ReturnType<typeof notify.flushPendingOrderPushes> | undefined;
  try {
    primero = notify.flushPendingOrderPushes();
    await empezo;
    const segundo = await notify.flushPendingOrderPushes();
    assert.deepEqual(segundo, { enviados: 0, cerrados: 0, reintentos: 0 });
    assert.equal(llamadas, 1, "el segundo barrido volvió a mandar");
  } finally {
    soltar();
    await primero;
    push.transporte.enviar = aceptando;
  }
  const r = await primero;
  assert.deepEqual(r, { enviados: 2, cerrados: 2, reintentos: 0 });
  assert.equal(llamadas, 2, "un envío por persona");
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

test("dos guardados a la vez no pierden la cuenta de la tanda", async () => {
  // El barrido cierra la tanda solo si `changeCount` no cambió mientras
  // mandaba. Si dos guardados juntos leyeran el mismo número y escribieran el
  // mismo resultado, un cambio podría colarse sin que el cierre lo note.
  await limpiar();
  await notify.notifyOrderChange(ACTOR(), ids.evento, HIELO);

  // Se fuerza el peor orden: los dos guardados leen la tanda abierta antes de
  // que cualquiera de los dos escriba. Sin esto, el orden lo decide el azar.
  const { prisma: base } = await import("../lib/db");
  const leer = base.notification.findFirst;
  let enEspera: (() => void) | null = null;
  base.notification.findFirst = (async (...args: unknown[]) => {
    const r = await (leer as (...a: unknown[]) => Promise<unknown>).apply(base.notification, args);
    if (enEspera) {
      const otro = enEspera;
      enEspera = null;
      otro();
    } else {
      // El tope es por si algún día lee uno solo: que la prueba falle, no que se cuelgue.
      await new Promise<void>((listo) => {
        enEspera = listo;
        setTimeout(listo, 1000);
      });
    }
    return r;
  }) as unknown as typeof leer;
  try {
    await Promise.all([
      notify.notifyOrderChange(ACTOR(), ids.evento, { itemName: "Vasos", kind: "CANTIDAD", before: "1", after: "2" }),
      notify.notifyOrderChange(ACTOR(), ids.evento, { itemName: "Copa", kind: "CANTIDAD", before: "3", after: "4" }),
    ]);
  } finally {
    base.notification.findFirst = leer;
  }
  for (const quien of [ids.logistica, ids.armador]) {
    const lista = await avisos(quien);
    assert.equal(lista.length, 1);
    assert.equal(lista[0].changeCount, 3);
    assert.equal(lista[0].message, "Ana hizo 3 cambios en el pedido de El Carmen Center");
  }
});

test("un cambio que llega justo cuando el barrido cierra la tanda abre una tanda nueva", async () => {
  // El guardado encuentra la tanda abierta y, antes de que llegue a sumarle el
  // cambio, el barrido la cierra. Antes el cambio se sumaba igual a la tanda ya
  // avisada y nunca salía al teléfono.
  await limpiar();
  await notify.notifyOrderChange(ACTOR(), ids.evento, HIELO);
  const viejas = new Set((await prisma.notification.findMany()).map((a) => a.id));

  // Se fuerza ese orden: cada vez que el guardado lee una tanda abierta, se la
  // cierra antes de devolvérsela, como si el barrido hubiera terminado ahí.
  const { prisma: base } = await import("../lib/db");
  const leer = base.notification.findFirst;
  base.notification.findFirst = (async (...args: unknown[]) => {
    const r = (await (leer as (...a: unknown[]) => Promise<unknown>).apply(base.notification, args)) as { id: string } | null;
    if (r) await prisma.notification.updateMany({ where: { id: r.id }, data: { pushedAt: new Date() } });
    return r;
  }) as unknown as typeof leer;
  try {
    await notify.notifyOrderChange(ACTOR(), ids.evento, { itemName: "Vasos", kind: "CANTIDAD", before: "1", after: "2" });
  } finally {
    base.notification.findFirst = leer;
  }

  for (const quien of [ids.logistica, ids.armador]) {
    const lista = await avisos(quien);
    assert.equal(lista.length, 2, "el cambio se sumó a la tanda ya cerrada");
    const [nueva] = lista.filter((a) => !viejas.has(a.id));
    assert.ok(nueva, "no se abrió una tanda nueva");
    assert.equal(nueva.pushedAt, null);
    assert.equal(nueva.changeCount, 1);
    assert.deepEqual((await notify.cambiosDeLaTanda(nueva)).map((c) => c.itemName), ["Vasos"]);
  }

  // Pasada la quietud, el cambio sale al teléfono.
  await pasaronMinutos(3);
  const antes = enviadosAlTelefono.length;
  const r = await notify.flushPendingOrderPushes();
  assert.equal(r.cerrados, 2);
  assert.equal(r.enviados, 2);
  const nuevos = enviadosAlTelefono.slice(antes);
  assert.deepEqual(nuevos.map((x) => x.endpoint).sort(), [TEL_ENRIQUE, TEL_PABLO].sort());
  for (const x of nuevos) assert.equal(x.body, "Vasos 1→2\n— Ana");
});

const tandas = (recipientId: string, type: string) =>
  prisma.notification.findMany({ where: { recipientId, type }, orderBy: { createdAt: "desc" } });

test("un cambio tardío va a su propia tanda, que abre la pantalla de preparar", async () => {
  await limpiar();
  await notify.notifyOrderChange(ACTOR(), ids.evento, {
    itemName: "Copa de agua", kind: "CANTIDAD", before: "10", after: "24", tardio: true,
  });
  const [t] = await tandas(ids.logistica, "CAMBIO_TARDIO");
  assert.ok(t, "no abrió la tanda de cambio tardío");
  assert.equal(t.linkUrl, `/preparar/${ids.evento}`);
  assert.match(t.message, /ya preparado/);
  assert.equal((await tandas(ids.logistica, "ORDER_EDIT")).length, 0, "lo tardío no va además a la tanda común");
  const [c] = await prisma.orderChange.findMany({ where: { itemName: "Copa de agua" } });
  assert.equal(c.tardio, true);
});

test("un guardado con cambios tardíos y comunes abre una tanda de cada una", async () => {
  await limpiar();
  await notify.notifyOrderChange(ACTOR(), ids.evento, [
    { itemName: "Copa de agua", kind: "CANTIDAD", before: "10", after: "24", tardio: true },
    { itemName: "Servilletas", kind: "AGREGADO", before: null, after: "50" },
  ]);
  assert.equal((await tandas(ids.logistica, "CAMBIO_TARDIO"))[0]?.changeCount, 1);
  assert.equal((await tandas(ids.logistica, "ORDER_EDIT"))[0]?.changeCount, 1);
});

test("'Qué cambió' de la tanda común no muestra los cambios tardíos", async () => {
  const [comun] = await tandas(ids.logistica, "ORDER_EDIT");
  const cambios = await notify.cambiosDeLaTanda(comun);
  assert.deepEqual(cambios.map((c) => c.itemName), ["Servilletas"]);
});

// Va después de "'Qué cambió'..." y no pegada a "un guardado con cambios tardíos
// y comunes...": esa prueba lee la tanda ORDER_EDIT que dejó el guardado, y este
// test empieza con limpiar().
test("un segundo cambio tardío de la misma persona se suma a la misma tanda abierta", async () => {
  await limpiar();
  await notify.notifyOrderChange(ACTOR(), ids.evento, { itemName: "Copa de agua", kind: "CANTIDAD", before: "10", after: "24", tardio: true });
  await notify.notifyOrderChange(ACTOR(), ids.evento, { itemName: "Brasero", kind: "QUITADO", before: "3", after: null, tardio: true });
  const tardias = await tandas(ids.logistica, "CAMBIO_TARDIO");
  assert.equal(tardias.length, 1, "abrió una tanda por cada cambio tardío");
  assert.equal(tardias[0].changeCount, 2);
  assert.equal(tardias[0].message, "Ana cambió 2 ítems ya preparados de El Carmen Center");
});

test("el aviso tardío dice qué rehacer, abre Preparar y sale con prioridad para todos", async () => {
  await limpiar();
  const copa = await prisma.product.create({ data: { name: "Copa de agua", category: "ENSERES", type: "REUTILIZABLE", stock: 500 } });
  await prisma.orderLine.create({ data: { eventId: ids.evento, productId: copa.id, qty: 24 } });
  await prisma.preparacion.create({
    data: { eventId: ids.evento, clave: copa.id, itemName: "Copa de agua", unit: "Unidad", category: "ENSERES", qty: 10, porName: "Pablo" },
  });
  const antes = enviadosAlTelefono.length;
  await notify.notifyOrderChange(ACTOR(), ids.evento, {
    itemName: "Copa de agua", kind: "CANTIDAD", before: "10", after: "24", tardio: true,
  });
  await pasaronMinutos(3);
  const r = await notify.flushPendingOrderPushes();
  assert.equal(r.enviados, 2);
  const nuevos = enviadosAlTelefono.slice(antes);
  assert.equal(nuevos.length, 2);
  for (const p of nuevos) {
    assert.match(p.title, /^⚠ Cambio en pedido ya preparado · El Carmen Center$/, "sin HOY: el evento no es hoy");
    assert.equal(p.body, "Sumá 14 Copa de agua\n— Ana");
    assert.equal(p.url, `/preparar/${ids.evento}`);
    // Su propio tag: el aviso urgente no reemplaza en la pantalla al común, ni al revés.
    assert.equal(p.tag, `tardio-${ids.evento}`);
  }
  const entregas = await prisma.pushDelivery.findMany({ where: { kind: "CAMBIO_TARDIO" } });
  assert.ok(entregas.length > 0 && entregas.every((e) => e.urgency === "high"), "el tardío sale con prioridad alta para todos");
  await prisma.preparacion.deleteMany({});
  await prisma.orderLine.deleteMany({ where: { productId: copa.id } });
});

test("si el depósito ya lo aplicó antes de que salga el aviso, no suena", async () => {
  await limpiar();
  const vaso = await prisma.product.create({ data: { name: "Vaso", category: "ENSERES", type: "REUTILIZABLE", stock: 500 } });
  await prisma.orderLine.create({ data: { eventId: ids.evento, productId: vaso.id, qty: 30 } });
  await prisma.preparacion.create({
    data: { eventId: ids.evento, clave: vaso.id, itemName: "Vaso", unit: "Unidad", category: "ENSERES", qty: 20, porName: "Pablo" },
  });
  await notify.notifyOrderChange(ACTOR(), ids.evento, { itemName: "Vaso", kind: "CANTIDAD", before: "20", after: "30", tardio: true });
  // El depósito vuelve a tildar con la cantidad nueva: ya no queda nada para aplicar.
  await prisma.preparacion.updateMany({ where: { clave: vaso.id }, data: { qty: 30 } });
  await pasaronMinutos(3);
  const antes = enviadosAlTelefono.length;
  const r = await notify.flushPendingOrderPushes();
  assert.equal(r.enviados, 0);
  assert.equal(enviadosAlTelefono.length, antes);
  // Se cerró en silencio y no quedó para reintentar: no es que falló al armar el texto.
  assert.equal(r.cerrados, 2);
  const tardias = await prisma.notification.findMany({ where: { type: "CAMBIO_TARDIO" } });
  assert.ok(tardias.length === 2 && tardias.every((t) => t.pushedAt !== null), "las dos tandas tienen que quedar cerradas");
  await prisma.preparacion.deleteMany({});
  await prisma.orderLine.deleteMany({ where: { productId: vaso.id } });
});

test("un evento que no existe no rompe el guardado del pedido", async () => {
  await assert.doesNotReject(() =>
    notify.notifyOrderChange(ACTOR(), "id-que-no-existe", { itemName: "x", kind: "CANTIDAD", after: "1" })
  );
});

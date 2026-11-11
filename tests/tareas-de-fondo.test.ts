import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import type { ListObjectsV2Command } from "@aws-sdk/client-s3";
import { crearBaseDescartable } from "./helpers/base-descartable";
import { instanteDe } from "../lib/dates";

/**
 * Las tareas que corren solas: el aviso de pedido vacío, la revisión diaria y
 * el listado de los respaldos.
 *
 * Tres cosas que fallaban calladas:
 *  - "Falta armar un pedido" sonaba a la hora del último despliegue, también de
 *    madrugada;
 *  - si la revisión diaria fallaba entera, devolvía una lista vacía y el log
 *    decía "todo en orden";
 *  - los respaldos se listaban con un solo llamado (hasta 1000 objetos, los más
 *    viejos primero).
 */

const base = crearBaseDescartable("tareas-de-fondo");
let prisma: typeof import("../lib/db").prisma;
let vacio: typeof import("../lib/pedido-vacio");
let salud: typeof import("../lib/healthcheck");
let s3: typeof import("../lib/s3-respaldo");
let armadora: string;

const DIA = "2026-11-10"; // martes
const a = (hora: string) => instanteDe(DIA, hora);

before(async () => {
  ({ prisma } = await import("../lib/db"));
  vacio = await import("../lib/pedido-vacio");
  salud = await import("../lib/healthcheck");
  s3 = await import("../lib/s3-respaldo");
  armadora = (await prisma.user.create({ data: { name: "Aldana", email: "aldana@test.local", passwordHash: "x", role: "ADMIN" } })).id;
  await prisma.user.create({ data: { name: "Dante", email: "dante@test.local", passwordHash: "x", role: "DEPOSITO" } });
  const p = await prisma.operationalPeriod.create({ data: { startDay: DIA, endDay: "2026-11-15" } });
  // Un evento de mañana, sin pedido.
  await prisma.event.create({ data: { periodId: p.id, lugar: "Puerto Arriba", date: instanteDe("2026-11-11", "21:00") } });
});

after(async () => {
  await prisma?.$disconnect();
  base.borrar();
});

// ---------------------------------------------------------------------------
// Pedido vacío: la franja horaria
// ---------------------------------------------------------------------------

test("la franja es de 8 a 20, hora argentina", () => {
  for (const h of [0, 1, 3, 7, 20, 21, 23]) assert.equal(vacio.esHoraDeAvisar(h), false, `avisa a las ${h}`);
  for (const h of [8, 9, 13, 19]) assert.equal(vacio.esHoraDeAvisar(h), true, `no avisa a las ${h}`);
});

test("de madrugada no avisa nada, aunque haya un evento de mañana sin pedido", async () => {
  // El caso: un despliegue a la 1 de la mañana arranca el servidor y el barrido.
  for (const hora of ["01:00", "03:30", "07:59", "20:00", "23:30"]) {
    assert.deepEqual(await vacio.notificarPedidosVacios(a(hora)), { avisos: 0, eventos: 0 }, `avisó a las ${hora}`);
  }
  assert.equal(await prisma.notification.count(), 0);
});

test("la franja se mide en hora argentina, no en la del servidor", async () => {
  // 10:30 UTC son las 7:30 en Argentina: todavía no. 11:00 UTC son las 8:00: sí.
  assert.equal((await vacio.notificarPedidosVacios(new Date("2026-11-10T10:30:00.000Z"))).avisos, 0);
  assert.equal(await prisma.notification.count(), 0);
});

test("dentro de la franja avisa a quien arma pedidos, una sola vez aunque el barrido corra cada 10 minutos", async () => {
  const primera = await vacio.notificarPedidosVacios(a("08:00"));
  assert.deepEqual(primera, { avisos: 1, eventos: 1 }, "le avisa a la que arma pedidos, no al depósito");
  const aviso = await prisma.notification.findFirstOrThrow();
  assert.equal(aviso.recipientId, armadora);
  assert.match(aviso.message, /"Puerto Arriba" es mañana y su pedido está vacío/);
  for (const hora of ["08:10", "08:20", "12:00", "19:50"]) {
    assert.equal((await vacio.notificarPedidosVacios(a(hora))).avisos, 0, `repitió el aviso a las ${hora}`);
  }
  assert.equal(await prisma.notification.count(), 1);
});

test("el barrido de pedido vacío corre cada 10 minutos, no atado a la hora del arranque", () => {
  const s = fs.readFileSync(path.resolve(__dirname, "..", "instrumentation.ts"), "utf8");
  assert.match(s, /setInterval\(\(\) => void avisarVacios\(\), 10 \* MINUTE\)/);
  assert.doesNotMatch(s, /setInterval\(\(\) => void avisarVacios\(\), DAY\)/);
});

// ---------------------------------------------------------------------------
// La revisión diaria no puede fallar callada
// ---------------------------------------------------------------------------

test("si la revisión falla entera, eso es un problema urgente y se avisa: nunca 'todo en orden'", async () => {
  const errores: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => void errores.push(args.join(" "));
  try {
    const r = await salud.runHealthCheck(async () => {
      throw new Error("no hay conexión con el almacenamiento");
    });
    assert.deepEqual(r.problems.map((p) => [p.code, p.gravedad]), [["revision-fallida", "alta"]]);
    assert.equal(r.notified, true);
    const aviso = await prisma.notification.findFirstOrThrow({ where: { type: "SISTEMA:revision-fallida" } });
    assert.equal(aviso.recipientId, armadora);
    assert.match(aviso.message, /no se pudo revisar/);
    assert.ok(errores.some((e) => e.includes("no hay conexión con el almacenamiento")), "el error técnico no quedó en el log");

    // Al día siguiente sigue fallando: el problema se informa, pero no vuelve a sonar.
    const otra = await salud.runHealthCheck(async () => {
      throw new Error("sigue caído");
    });
    assert.deepEqual([otra.problems.length, otra.notified], [1, false]);
    assert.equal(await prisma.notification.count({ where: { type: "SISTEMA:revision-fallida" } }), 1);
  } finally {
    console.error = original;
  }
});

test("una revisión sin problemas sigue diciendo que no hay nada", async () => {
  assert.deepEqual(await salud.runHealthCheck(async () => []), { problems: [], notified: false });
});

test("varios controles caídos son un solo problema, con la misma firma cualquiera sea el que falle", () => {
  const original = console.error;
  console.error = () => {};
  try {
    const uno = salud.problemaDeRevisionFallida("el stock sin contar", new Error("x"));
    const otro = salud.problemaDeRevisionFallida("los controles de datos", new Error("y"));
    assert.equal(uno.code, otro.code);
    assert.equal(salud.avisoDe([uno])?.signature, salud.avisoDe([otro])?.signature);
    assert.equal(salud.agruparHallazgos([uno, otro]).length, 1);
  } finally {
    console.error = original;
  }
});

test("ni la revisión ni el aviso de pedido vacío tragan un error sin dejarlo en el log", () => {
  const fuente = (rel: string) => fs.readFileSync(path.resolve(__dirname, "..", rel), "utf8");
  for (const rel of ["lib/healthcheck.ts", "lib/pedido-vacio.ts"]) {
    assert.doesNotMatch(fuente(rel), /catch\s*\{/, `${rel} tiene un catch que no mira el error`);
  }
  // En `notifyOrderChange`, lo mismo: el cambio se guarda igual, pero el fallo
  // del aviso se anota. (El otro `catch` del archivo es el de un JSON ilegible
  // del registro de envíos, que tiene su respuesta y no esconde nada.)
  const notify = fuente("lib/notify.ts");
  const desde = notify.indexOf("export async function notifyOrderChange");
  const cuerpo = notify.slice(desde, notify.indexOf("\nexport ", desde + 1));
  assert.doesNotMatch(cuerpo, /catch\s*\{/, "notifyOrderChange traga el error del aviso");
  assert.match(cuerpo, /catch \(e\) \{[^}]*console\.error\(/);
});

// ---------------------------------------------------------------------------
// El listado de los respaldos
// ---------------------------------------------------------------------------

/** Un S3 de mentira: `n` copias, una por día, en páginas de `porPagina`. */
function s3DeMentira(n: number, porPagina: number) {
  const todos = Array.from({ length: n }, (_, i) => ({
    Key: `backups/dev-${String(i).padStart(5, "0")}.db`,
    LastModified: new Date(Date.UTC(2026, 0, 1) + i * 86_400_000),
    Size: 100,
  }));
  const pedidos: (string | undefined)[] = [];
  return {
    pedidos,
    async send(comando: ListObjectsV2Command) {
      const token = comando.input.ContinuationToken;
      pedidos.push(token);
      const desde = token ? Number(token) : 0;
      const hasta = Math.min(desde + porPagina, todos.length);
      return { Contents: todos.slice(desde, hasta), IsTruncated: hasta < todos.length, NextContinuationToken: hasta < todos.length ? String(hasta) : undefined };
    },
  };
}

test("lista todas las copias siguiendo las páginas, y la más nueva es la de la última", async () => {
  const falso = s3DeMentira(2500, 1000);
  const todo = await s3.listarTodo(falso, "bucket", "backups/");
  assert.equal(todo.length, 2500);
  assert.deepEqual(falso.pedidos, [undefined, "1000", "2000"]);
  // Con un solo llamado, "la más nueva" habría sido la número 999.
  assert.equal(s3.masNueva(todo)?.key, "backups/dev-02499.db");
});

test("con una sola página hace un solo pedido; sin copias devuelve una lista vacía", async () => {
  const falso = s3DeMentira(14, 1000);
  assert.equal((await s3.listarTodo(falso, "bucket", "backups/")).length, 14);
  assert.equal(falso.pedidos.length, 1);
  assert.deepEqual(await s3.listarTodo(s3DeMentira(0, 1000), "bucket", "backups/"), []);
  assert.equal(s3.masNueva([]), null);
});

test("un servicio que dice 'hay más' sin decir por dónde seguir no deja el barrido dando vueltas", async () => {
  const roto = { async send() { return { Contents: [{ Key: "backups/a.db" }], IsTruncated: true }; } };
  await assert.rejects(s3.listarTodo(roto, "bucket", "backups/"), /no por dónde seguir/);
  const enCirculo = { async send() { return { Contents: [], IsTruncated: true, NextContinuationToken: "igual" }; } };
  await assert.rejects(s3.listarTodo(enCirculo, "bucket", "backups/"), /no por dónde seguir/);
});

test("el respaldo, la revisión y la prueba de restauración usan el mismo cliente y el listado completo", () => {
  for (const rel of ["lib/backup.ts", "lib/healthcheck.ts", "lib/verificar-respaldo.ts"]) {
    const s = fs.readFileSync(path.resolve(__dirname, "..", rel), "utf8");
    assert.doesNotMatch(s, /new S3Client\(/, `${rel} arma su propio cliente de S3`);
    assert.doesNotMatch(s, /ListObjectsV2Command/, `${rel} lista por su cuenta, sin paginar`);
    assert.match(s, /respaldoConfigurado\(\)/);
    assert.match(s, /listarTodo\(/);
  }
});

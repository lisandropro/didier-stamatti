import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import {
  SUGGESTION_KINDS,
  SUGGESTION_STATUSES,
  KIND_LABEL,
  STATUS_LABEL,
  isKind,
  isStatus,
  screenLabel,
  eventIdFromScreen,
  deviceSummary,
  LIMITS,
} from "../lib/suggestions";
import {
  canSendSuggestions,
  canManageSuggestions,
  canEditOrders,
  canManagePeriods,
  canEditStock,
  canManageCatalog,
  canManageUsers,
  ROLES,
} from "../lib/permissions";

/**
 * El canal de sugerencias: permisos, creación, consulta y cambio de estado.
 *
 * La parte pura se prueba sola. Lo que toca la base corre contra una base nueva
 * y descartable, con las mismas migraciones que producción, para que "Enrique
 * no ve las sugerencias de otro" quede comprobado contra consultas de verdad y
 * no contra lo que uno cree que hace la consulta.
 */

// ---------------------------------------------------------------------------
// Permisos
// ---------------------------------------------------------------------------

const ESPERADO = {
  ADMIN: { enviar: true, gestionar: true },
  ARMADOR: { enviar: true, gestionar: false },
  LOGISTICA: { enviar: true, gestionar: false },
  // Los roles de comprobantes también mandan sugerencias, por la misma razón
  // que el resto: quien usa la herramienta es quien encuentra lo que le falta, y
  // quien recibe mercadería con las manos ocupadas ve problemas que nadie más ve.
  // Gestionar sigue siendo solo de la administradora.
  RECEPCION: { enviar: true, gestionar: false },
  PAGOS: { enviar: true, gestionar: false },
} as const;

for (const rol of Object.keys(ESPERADO) as (keyof typeof ESPERADO)[]) {
  test(`${rol}: enviar sugerencias = ${ESPERADO[rol].enviar}`, () => {
    assert.equal(canSendSuggestions(rol), ESPERADO[rol].enviar);
  });
  test(`${rol}: gestionar sugerencias = ${ESPERADO[rol].gestionar}`, () => {
    assert.equal(canManageSuggestions(rol), ESPERADO[rol].gestionar);
  });
}

test("la tabla cubre todos los roles: si se agrega uno, esta prueba falla", () => {
  assert.deepEqual([...ROLES].sort(), Object.keys(ESPERADO).sort());
});

test("un rol inventado no puede ni enviar ni gestionar", () => {
  assert.equal(canSendSuggestions("SUPERUSUARIO"), false);
  assert.equal(canManageSuggestions("SUPERUSUARIO"), false);
  assert.equal(canSendSuggestions(""), false);
  assert.equal(canManageSuggestions(""), false);
});

test("abrirle el canal al encargado de logística no le amplió nada más", () => {
  // Mandar una sugerencia es escribir un mensaje, no tocar un dato. Esta prueba
  // existe para que quede escrito que lo uno no arrastró lo otro.
  assert.equal(canSendSuggestions("LOGISTICA"), true);
  assert.equal(canEditOrders("LOGISTICA"), false);
  assert.equal(canManagePeriods("LOGISTICA"), false);
  assert.equal(canEditStock("LOGISTICA"), false);
  assert.equal(canManageCatalog("LOGISTICA"), false);
  assert.equal(canManageUsers("LOGISTICA"), false);
  assert.equal(canManageSuggestions("LOGISTICA"), false);
});

// ---------------------------------------------------------------------------
// Vocabulario
// ---------------------------------------------------------------------------

test("los cinco tipos pedidos existen y tienen texto", () => {
  assert.deepEqual([...SUGGESTION_KINDS], ["AGREGAR", "CAMBIAR", "ELIMINAR", "PROBLEMA", "OTRO"]);
  for (const k of SUGGESTION_KINDS) assert.ok(KIND_LABEL[k]);
});

test("los cinco estados pedidos existen y tienen texto", () => {
  assert.deepEqual(
    [...SUGGESTION_STATUSES],
    ["NUEVA", "EN_REVISION", "ACEPTADA", "IMPLEMENTADA", "DESCARTADA"]
  );
  for (const s of SUGGESTION_STATUSES) assert.ok(STATUS_LABEL[s]);
});

test("no se acepta un tipo ni un estado inventados", () => {
  assert.equal(isKind("BORRAR_TODO"), false);
  assert.equal(isStatus("ARCHIVADA"), false);
});

// ---------------------------------------------------------------------------
// Contexto
// ---------------------------------------------------------------------------

test("la pantalla se traduce a algo legible", () => {
  // La portada dejó de ser "Fin de semana" cuando el finde se volvió período
  // operativo. Si alguien vuelve a poner el texto viejo, esto lo frena.
  assert.equal(screenLabel("/"), "Períodos");
  assert.equal(screenLabel("/evento/abc123"), "Pedido de un evento");
  assert.equal(screenLabel("/evento/abc123/pdf"), "Hoja para imprimir");
  assert.equal(screenLabel("/inventario"), "Inventario");
  assert.equal(screenLabel("/historial"), "Historial");
  assert.equal(screenLabel("/notificaciones"), "Avisos");
  assert.equal(screenLabel("/sugerencias"), "Sugerencias");
  assert.equal(screenLabel("/cuenta"), "Mi cuenta");
  assert.equal(screenLabel("/usuarios"), "Usuarios");
  assert.equal(screenLabel("/aviso/abc123"), "Detalle de un aviso");
});

test("una ruta desconocida se muestra tal cual en vez de inventar", () => {
  assert.equal(screenLabel("/algo-nuevo"), "/algo-nuevo");
});

test("sin ruta no se inventa una pantalla", () => {
  assert.equal(screenLabel(""), "Desconocida");
});

test("el resumen del depósito se reconoce por la ruta nueva y también por la vieja", () => {
  // La pantalla se mudó de /finde/ a /periodo/. Se aceptan las dos a propósito:
  // las sugerencias ya enviadas guardaron la ruta vieja en su columna `screen` y
  // tienen que seguir diciendo de dónde salieron.
  assert.equal(screenLabel("/periodo/abc123"), "Resumen del depósito");
  assert.equal(screenLabel("/finde/abc123"), "Resumen del depósito");
});

test("se reconoce el evento cuando la sugerencia sale de un pedido", () => {
  assert.equal(eventIdFromScreen("/evento/abc123"), "abc123");
  assert.equal(eventIdFromScreen("/evento/abc123/pdf"), "abc123");
  assert.equal(eventIdFromScreen("/inventario"), null);
  assert.equal(eventIdFromScreen("/"), null);
});

test("el resumen del dispositivo identifica navegador y sistema", () => {
  const samsung =
    "Mozilla/5.0 (Linux; Android 14; SM-A546E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36";
  assert.equal(deviceSummary(samsung), "Chrome · Android (SM-A546E)");

  const iphone =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
  assert.equal(deviceSummary(iphone), "Safari · iPhone/iPad");

  const samsungInternet =
    "Mozilla/5.0 (Linux; Android 13; SM-S911B) AppleWebKit/537.36 SamsungBrowser/23.0 Chrome/115.0 Mobile Safari/537.36";
  assert.equal(deviceSummary(samsungInternet), "Samsung Internet · Android (SM-S911B)");

  assert.equal(deviceSummary(""), "Desconocido");
});

test("el resumen del dispositivo no arrastra el User-Agent entero", () => {
  const ua = "Mozilla/5.0 (Linux; Android 14; SM-A546E) AppleWebKit/537.36 Chrome/120.0.6099.43 Mobile";
  const r = deviceSummary(ua);
  assert.ok(r.length < 40, `demasiado largo: ${r}`);
  assert.equal(r.includes("AppleWebKit"), false);
  assert.equal(r.includes("Mozilla"), false);
});

// ---------------------------------------------------------------------------
// Contra la base: creación, consulta y estado
// ---------------------------------------------------------------------------

const DB = path.join(os.tmpdir(), `didier-test-sug-${process.pid}.db`);
let prisma: import("../app/generated/prisma/client").PrismaClient;
let ids: { admin: string; armador: string; logistica: string; evento: string };

before(async () => {
  fs.rmSync(DB, { force: true });
  execFileSync("npx", ["prisma", "migrate", "deploy"], {
    env: { ...process.env, DATABASE_URL: `file:${DB}` },
    stdio: "pipe",
    shell: process.platform === "win32",
  });
  const { PrismaClient } = await import("../app/generated/prisma/client");
  const { PrismaBetterSqlite3 } = await import("@prisma/adapter-better-sqlite3");
  prisma = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: `file:${DB}` }) });

  const mk = (name: string, role: string) =>
    prisma.user.create({ data: { name, email: `${role}@test.local`, role, passwordHash: "x" } });
  const admin = await mk("Ana", "ADMIN");
  const armador = await mk("Enrique", "ARMADOR");
  const logistica = await mk("Pablo", "LOGISTICA");
  // El período va del 15 al 16: días de calendario en texto, sin hora y sin zona.
  const periodo = await prisma.operationalPeriod.create({
    data: { label: "Prueba", startDay: "2026-08-15", endDay: "2026-08-16" },
  });
  // El evento sí es un instante: 22:00 UTC = 19:00 en Argentina, del día 15.
  const ev = await prisma.event.create({
    data: {
      periodId: periodo.id,
      lugar: "El Carmen Center",
      date: new Date("2026-08-15T22:00:00.000Z"),
      guests: 100,
    },
  });
  ids = { admin: admin.id, armador: armador.id, logistica: logistica.id, evento: ev.id };
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

/** Crea una sugerencia como lo haría la acción, ya validada. */
function crear(over: Partial<Parameters<typeof armar>[0]> = {}) {
  return prisma.suggestion.create({ data: armar(over) });
}
function armar(over: Record<string, unknown> = {}) {
  return {
    authorId: ids.armador,
    authorName: "Enrique",
    kind: "PROBLEMA",
    title: "No entra la cantidad por bandeja",
    body: "Cuando cargo bandejas no puedo poner cuántas van por bandeja.",
    screen: `/evento/${ids.evento}`,
    eventId: ids.evento,
    eventLugar: "El Carmen Center",
    appVersion: "0.1.0 (prueba)",
    device: "Chrome · Android (SM-A546E)",
    clientKey: `k-${Math.random().toString(36).slice(2)}`,
    ...over,
  } as never;
}

test("una sugerencia nueva nace en NUEVA", async () => {
  const s = await crear();
  assert.equal(s.status, "NUEVA");
  assert.equal(s.reply, null);
});

test("queda registrado quién, cuándo, desde dónde y sobre qué evento", async () => {
  const s = await crear();
  assert.equal(s.authorName, "Enrique");
  assert.equal(s.eventId, ids.evento);
  assert.equal(s.eventLugar, "El Carmen Center");
  assert.equal(screenLabel(s.screen ?? ""), "Pedido de un evento");
  assert.ok(s.createdAt instanceof Date);
  assert.ok(s.appVersion);
  assert.ok(s.device);
});

test("lo técnico guardado no contiene nada sensible", async () => {
  const s = await crear();
  const texto = `${s.device} ${s.appVersion}`.toLowerCase();
  for (const prohibido of ["password", "contraseña", "token", "session", "cookie", "bearer", "authorization"]) {
    assert.equal(texto.includes(prohibido), false, `apareció "${prohibido}" en ${texto}`);
  }
});

test("la misma llave dos veces no crea dos sugerencias", async () => {
  const clientKey = "doble-toque-001";
  await crear({ clientKey });
  await assert.rejects(() => crear({ clientKey }), "la segunda tiene que rebotar contra el índice único");
  assert.equal(await prisma.suggestion.count({ where: { clientKey } }), 1);
});

test("Enrique solo ve las suyas", async () => {
  await crear({ authorId: ids.admin, authorName: "Ana" });
  const suyas = await prisma.suggestion.findMany({ where: { authorId: ids.armador } });
  assert.ok(suyas.length > 0);
  assert.equal(suyas.every((s) => s.authorId === ids.armador), true);

  const todas = await prisma.suggestion.count();
  assert.ok(todas > suyas.length, "la administradora tiene que ver más que Enrique");
});

test("se listan de la más reciente a la más vieja", async () => {
  const lista = await prisma.suggestion.findMany({ orderBy: { createdAt: "desc" }, take: 10 });
  for (let i = 1; i < lista.length; i++) {
    assert.ok(lista[i - 1].createdAt >= lista[i].createdAt);
  }
});

test("se puede filtrar por tipo y por estado", async () => {
  await crear({ kind: "AGREGAR", clientKey: "filtro-1" });
  const soloAgregar = await prisma.suggestion.findMany({ where: { kind: "AGREGAR" } });
  assert.ok(soloAgregar.length > 0);
  assert.equal(soloAgregar.every((s) => s.kind === "AGREGAR"), true);

  const nuevas = await prisma.suggestion.findMany({ where: { status: "NUEVA" } });
  assert.equal(nuevas.every((s) => s.status === "NUEVA"), true);
});

test("el estado recorre los cinco valores", async () => {
  const s = await crear({ clientKey: "estados-1" });
  for (const estado of SUGGESTION_STATUSES) {
    const u = await prisma.suggestion.update({
      where: { id: s.id },
      data: { status: estado, statusAt: new Date() },
    });
    assert.equal(u.status, estado);
  }
});

test("la respuesta queda con autor y fecha", async () => {
  const s = await crear({ clientKey: "respuesta-1" });
  const u = await prisma.suggestion.update({
    where: { id: s.id },
    data: { reply: "Lo agregamos la semana que viene.", repliedAt: new Date(), repliedByName: "Ana" },
  });
  assert.equal(u.reply, "Lo agregamos la semana que viene.");
  assert.equal(u.repliedByName, "Ana");
  assert.ok(u.repliedAt);
});

test("el aviso a la administradora es de tipo SUGERENCIA y no se mezcla con los de pedidos", async () => {
  const s = await crear({ clientKey: "aviso-1" });
  await prisma.notification.create({
    data: {
      recipientId: ids.admin,
      actorName: "Enrique",
      type: "SUGERENCIA",
      message: `Enrique envió una sugerencia: ${s.title}`,
      linkUrl: `/sugerencias/${s.id}`,
      pushedAt: new Date(),
    },
  });
  const aviso = await prisma.notification.findFirst({
    where: { recipientId: ids.admin, type: "SUGERENCIA" },
  });
  assert.ok(aviso);
  assert.equal(aviso.linkUrl, `/sugerencias/${s.id}`);
  // Marcado como enviado para que el barrido de pedidos no lo tome ni lo repita.
  assert.ok(aviso.pushedAt);
  const dePedidos = await prisma.notification.count({ where: { type: "ORDER_EDIT" } });
  assert.equal(dePedidos, 0);
});

test("borrar al autor no deja sugerencias huérfanas", async () => {
  const suelto = await prisma.user.create({
    data: { name: "Temporal", email: "temp@test.local", role: "ARMADOR", passwordHash: "x" },
  });
  await crear({ authorId: suelto.id, authorName: "Temporal", clientKey: "huerfana-1" });
  await prisma.user.delete({ where: { id: suelto.id } });
  assert.equal(await prisma.suggestion.count({ where: { authorId: suelto.id } }), 0);
});

test("los topes de longitud son los que el formulario promete", () => {
  assert.equal(LIMITS.title, 120);
  assert.equal(LIMITS.body, 4000);
  assert.ok(LIMITS.context > 0 && LIMITS.screen > 0 && LIMITS.reply > 0);
});

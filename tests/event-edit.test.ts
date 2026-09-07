import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { diaDe, instanteDe } from "../lib/dates";
import { cubreDia, ubicarDia, type Periodo } from "../lib/period-fit";
import { planEventEdit, type EventoActual } from "../lib/event-edit";
import {
  canManagePeriods,
  canEditOrders,
  canEditStock,
  canManageCatalog,
  canManageUsers,
  canManageSuggestions,
  canSetResponsable,
  canSendSuggestions,
  canView,
  ROLES,
} from "../lib/permissions";

/**
 * Corregir el nombre y la fecha de un evento que ya tiene el pedido cargado.
 *
 * Lo que se protege acá: que el pedido no se toque, que el evento termine en el
 * período operativo que le corresponde, y que el cambio quede registrado. Un
 * error en esto no se ve el día que pasa — se ve el día del evento, cuando falta
 * la vajilla porque estaba contada contra el período equivocado.
 *
 * La regla nueva y la que más cuida este archivo: **cuando varios períodos
 * cubren la fecha, la app no elige.** Devuelve los candidatos y decide la
 * persona. La versión vieja desempataba sola ("el que empieza primero") y eso es
 * exactamente lo que no se puede volver a hacer.
 */

// ---------------------------------------------------------------------------
// Permisos
// ---------------------------------------------------------------------------

const PUEDE_CORREGIR = { ADMIN: true, ARMADOR: true, LOGISTICA: false, RECEPCION: false, PAGOS: false } as const; // los roles de comprobantes no gestionan eventos ni períodos

for (const rol of Object.keys(PUEDE_CORREGIR) as (keyof typeof PUEDE_CORREGIR)[]) {
  test(`${rol}: puede corregir un evento = ${PUEDE_CORREGIR[rol]}`, () => {
    assert.equal(canManagePeriods(rol), PUEDE_CORREGIR[rol]);
  });
}

test("la tabla cubre todos los roles: si se agrega uno, esta prueba falla", () => {
  assert.deepEqual([...ROLES].sort(), Object.keys(PUEDE_CORREGIR).sort());
});

test("al encargado de logística no se le tocó ningún permiso", () => {
  // Corregir un evento lo puede hacer quien arma el trabajo, no quien lo mira.
  // Esta prueba existe para que abrir la corrección no arrastre nada más.
  assert.equal(canManagePeriods("LOGISTICA"), false);
  assert.equal(canEditOrders("LOGISTICA"), false);
  assert.equal(canEditStock("LOGISTICA"), false);
  assert.equal(canManageCatalog("LOGISTICA"), false);
  assert.equal(canManageUsers("LOGISTICA"), false);
  assert.equal(canManageSuggestions("LOGISTICA"), false);
  // Lo único que sí puede escribir, más lo que solo mira o manda.
  assert.equal(canSetResponsable("LOGISTICA"), true);
  assert.equal(canView("LOGISTICA"), true);
  assert.equal(canSendSuggestions("LOGISTICA"), true);
});

test("un rol inventado no puede corregir eventos", () => {
  assert.equal(canManagePeriods("SUPERUSUARIO"), false);
  assert.equal(canManagePeriods(""), false);
});

// ---------------------------------------------------------------------------
// Qué se decide al corregir — sin base de datos
// ---------------------------------------------------------------------------

/** Un período operativo de mentira: días de calendario en texto, sin hora. */
const periodo = (id: string, label: string | null, startDay: string, endDay: string): Periodo => ({
  id,
  label,
  startDay,
  endDay,
});

const P_A = periodo("pA", "Del 14 al 15", "2026-08-14", "2026-08-15");
const P_B = periodo("pB", "Del 22 al 23", "2026-08-22", "2026-08-23");
const DOS = [P_A, P_B];

const ACTUAL: EventoActual = {
  lugar: "El Carmen",
  date: instanteDe("2026-08-15", "18:00"),
  guests: 110,
  periodId: "pA",
  periodLabel: "Del 14 al 15",
};

test("corregir solo el nombre no muda de período", () => {
  const p = planEventEdit(ACTUAL, { lugar: "El Carmen Center", date: ACTUAL.date, guests: 110 }, DOS);
  assert.equal(p.tipo, "guardar");
  if (p.tipo !== "guardar") return;
  assert.equal(p.semudó, false);
  assert.equal(p.destinoId, "pA");
  assert.deepEqual(
    p.cambios.map((c) => c.kind),
    ["LUGAR"]
  );
  assert.equal(p.cambios[0].before, "El Carmen");
  assert.equal(p.cambios[0].after, "El Carmen Center");
});

test("corregir la fecha a otro período muda el evento y lo deja anotado", () => {
  const p = planEventEdit(
    ACTUAL,
    { lugar: ACTUAL.lugar, date: instanteDe("2026-08-22", "18:00"), guests: 110 },
    DOS
  );
  assert.equal(p.tipo, "guardar");
  if (p.tipo !== "guardar") return;
  assert.equal(p.semudó, true);
  assert.equal(p.destinoId, "pB");
  assert.equal(p.destinoNombre, "Del 22 al 23");
  assert.deepEqual(
    p.cambios.map((c) => c.kind).sort(),
    ["FECHA", "PERIODO"]
  );
  const mudanza = p.cambios.find((c) => c.kind === "PERIODO")!;
  assert.equal(mudanza.before, "Del 14 al 15");
  assert.equal(mudanza.after, "Del 22 al 23");
});

test("cambiar la hora dentro del mismo día no muda de período", () => {
  // El período se decide por día de calendario, no por instante: correr el
  // evento de las 18 a las 21:30 no lo puede sacar de su grupo.
  const p = planEventEdit(
    ACTUAL,
    { lugar: ACTUAL.lugar, date: instanteDe("2026-08-15", "21:30"), guests: 110 },
    DOS
  );
  assert.equal(p.tipo, "guardar");
  if (p.tipo !== "guardar") return;
  assert.equal(p.semudó, false);
  assert.equal(p.destinoId, "pA");
  assert.deepEqual(
    p.cambios.map((c) => c.kind),
    ["FECHA"]
  );
});

test("un evento de las 23 sigue siendo del mismo día, no del siguiente", () => {
  // 2026-08-16T02:00Z son las 23 del 15 en Argentina. Si el día se leyera con la
  // zona del proceso (Railway corre en UTC) el evento se iría al 16 y quedaría
  // fuera de su período. Esta es la regresión que costó entender una vez.
  const tarde = new Date("2026-08-16T02:00:00.000Z");
  assert.equal(diaDe(tarde), "2026-08-15");
  const p = planEventEdit(ACTUAL, { lugar: ACTUAL.lugar, date: tarde, guests: 110 }, DOS);
  assert.equal(p.tipo, "guardar");
  if (p.tipo !== "guardar") return;
  assert.equal(p.destinoId, "pA");
  assert.equal(p.semudó, false);
});

test("guardar sin cambiar nada no genera nada que guardar", () => {
  const p = planEventEdit(ACTUAL, { lugar: "El Carmen", date: ACTUAL.date, guests: 110 }, DOS);
  assert.equal(p.tipo, "sin-cambios");
});

test("los espacios de más no cuentan como un cambio", () => {
  const p = planEventEdit(ACTUAL, { lugar: "  El Carmen  ", date: ACTUAL.date, guests: 110 }, DOS);
  assert.equal(p.tipo, "sin-cambios");
});

test("el lugar vacío se rechaza", () => {
  const p = planEventEdit(ACTUAL, { lugar: "   ", date: ACTUAL.date, guests: 110 }, DOS);
  assert.equal(p.tipo, "error");
});

test("un lugar larguísimo se rechaza en vez de guardarse cortado", () => {
  const p = planEventEdit(ACTUAL, { lugar: "x".repeat(81), date: ACTUAL.date, guests: 110 }, DOS);
  assert.equal(p.tipo, "error");
});

test("una fecha inválida se rechaza en vez de guardar cualquier cosa", () => {
  const p = planEventEdit(ACTUAL, { lugar: ACTUAL.lugar, date: new Date("no es fecha"), guests: 110 }, DOS);
  assert.equal(p.tipo, "error");
});

test("los invitados negativos se llevan a cero", () => {
  const p = planEventEdit(ACTUAL, { lugar: ACTUAL.lugar, date: ACTUAL.date, guests: -5 }, DOS);
  assert.equal(p.tipo, "guardar");
  if (p.tipo !== "guardar") return;
  assert.equal(p.cambios.find((c) => c.kind === "INVITADOS")!.after, "0");
});

// --- La regla central: varios períodos no se desempatan solos -----------------

const P_LARGO = periodo("pLargo", "Semana del 14", "2026-08-14", "2026-08-16");
const P_CORTO = periodo("pCorto", null, "2026-08-15", "2026-08-15");
const SUPERPUESTOS = [P_LARGO, P_CORTO];

test("si dos períodos cubren la fecha, la app no elige: pide elegir", () => {
  // Acá estaba la regla vieja de desempate. Si vuelve, este plan diría
  // "guardar" y la vajilla se contaría contra el grupo que eligió la máquina.
  const actual = { ...ACTUAL, periodId: "otro", periodLabel: "Otro" };
  const p = planEventEdit(actual, { lugar: "Nombre nuevo", date: ACTUAL.date, guests: 110 }, SUPERPUESTOS);
  assert.equal(p.tipo, "elegir-periodo");
  if (p.tipo !== "elegir-periodo") return;
  assert.deepEqual(p.candidatos.map((c) => c.id).sort(), ["pCorto", "pLargo"]);
});

test("al pedir que se elija, cada candidato viene con nombre y rango para reconocerlo", () => {
  const actual = { ...ACTUAL, periodId: "otro", periodLabel: "Otro" };
  const p = planEventEdit(actual, { lugar: "Nombre nuevo", date: ACTUAL.date, guests: 110 }, SUPERPUESTOS);
  assert.equal(p.tipo, "elegir-periodo");
  if (p.tipo !== "elegir-periodo") return;
  for (const c of p.candidatos) {
    assert.ok(c.nombre.trim().length > 0, "un candidato sin nombre no se puede elegir");
    assert.ok(c.rango.trim().length > 0, "un candidato sin rango no se puede distinguir");
  }
  // El que no tiene nombre propio se muestra por su rango, no vacío.
  const sinNombre = p.candidatos.find((c) => c.id === "pCorto")!;
  assert.equal(sinNombre.nombre, sinNombre.rango);
});

test("el período que ya tiene el evento se ofrece primero, pero no se da por elegido", () => {
  const actual = { ...ACTUAL, periodId: "pLargo", periodLabel: "Semana del 14" };
  const p = planEventEdit(actual, { lugar: "Nombre nuevo", date: ACTUAL.date, guests: 110 }, SUPERPUESTOS);
  assert.equal(p.tipo, "elegir-periodo", "quedarse donde estaba tiene que seguir siendo una decisión");
  if (p.tipo !== "elegir-periodo") return;
  assert.equal(p.candidatos[0].id, "pLargo");
});

test("se pide elegir aunque el único cambio sea el nombre", () => {
  // La fecha no se tocó y el evento ya vive en uno de los dos. Igual se
  // pregunta: la app no puede aprovechar un cambio de nombre para decidir sola.
  const actual = { ...ACTUAL, periodId: "pCorto", periodLabel: "Sáb 15 ago" };
  const p = planEventEdit(actual, { lugar: "El Carmen Center", date: actual.date, guests: 110 }, SUPERPUESTOS);
  assert.equal(p.tipo, "elegir-periodo");
});

test("con un solo período que cubre la fecha no se molesta a nadie", () => {
  // La contracara: preguntar cuando no hay nada que elegir sería igual de malo.
  const p = planEventEdit(ACTUAL, { lugar: "El Carmen Center", date: ACTUAL.date, guests: 110 }, DOS);
  assert.equal(p.tipo, "guardar");
});

// --- Cuando la persona ya eligió ----------------------------------------------

test("si la persona eligió un período, se respeta aunque haya otros que sirvan", () => {
  const actual = { ...ACTUAL, periodId: "pLargo", periodLabel: "Semana del 14" };
  const p = planEventEdit(
    actual,
    { lugar: ACTUAL.lugar, date: ACTUAL.date, guests: 110, periodoElegidoId: "pCorto" },
    SUPERPUESTOS
  );
  assert.equal(p.tipo, "guardar");
  if (p.tipo !== "guardar") return;
  assert.equal(p.destinoId, "pCorto");
  assert.equal(p.semudó, true);
  assert.deepEqual(
    p.cambios.map((c) => c.kind),
    ["PERIODO"]
  );
});

test("se rechaza el período elegido si no cubre la fecha del evento", () => {
  // Respetar la elección no puede significar dejar el evento colgado de un
  // período que no lo incluye: ahí es donde el pedido deja de contar.
  const p = planEventEdit(
    ACTUAL,
    { lugar: ACTUAL.lugar, date: ACTUAL.date, guests: 110, periodoElegidoId: "pB" },
    DOS
  );
  assert.equal(p.tipo, "error");
  if (p.tipo !== "error") return;
  assert.match(p.error, /2026-08-15/);
});

test("se rechaza un período elegido que no existe", () => {
  const p = planEventEdit(
    ACTUAL,
    { lugar: ACTUAL.lugar, date: ACTUAL.date, guests: 110, periodoElegidoId: "no-existe" },
    DOS
  );
  assert.equal(p.tipo, "error");
});

test("elegir el mismo período que ya tenía no cuenta como mudanza", () => {
  const p = planEventEdit(
    ACTUAL,
    { lugar: "El Carmen Center", date: ACTUAL.date, guests: 110, periodoElegidoId: "pA" },
    DOS
  );
  assert.equal(p.tipo, "guardar");
  if (p.tipo !== "guardar") return;
  assert.equal(p.semudó, false);
  assert.deepEqual(
    p.cambios.map((c) => c.kind),
    ["LUGAR"]
  );
});

// --- Cuando no hay ningún período ---------------------------------------------

test("una fecha sin período pide crear uno de ESE día, no de un fin de semana", () => {
  // 2026-09-19 es sábado. El modelo viejo proponía viernes a domingo; el nuevo
  // propone la jornada sola, que después se estira si hace falta.
  const p = planEventEdit(
    ACTUAL,
    { lugar: ACTUAL.lugar, date: instanteDe("2026-09-19", "18:00"), guests: 110 },
    DOS
  );
  assert.equal(p.tipo, "falta-periodo");
  if (p.tipo !== "falta-periodo") return;
  assert.equal(p.sugerido.startDay, "2026-09-19");
  assert.equal(p.sugerido.endDay, "2026-09-19");
  assert.match(p.sugerido.label, /19 sep/);
});

test("un evento de un martes propone ese martes, sin arrastrar el finde", () => {
  const p = planEventEdit(
    ACTUAL,
    { lugar: ACTUAL.lugar, date: instanteDe("2026-09-15", "12:00"), guests: 110 },
    DOS
  );
  assert.equal(p.tipo, "falta-periodo");
  if (p.tipo !== "falta-periodo") return;
  assert.equal(p.sugerido.startDay, "2026-09-15");
  assert.equal(p.sugerido.endDay, "2026-09-15");
});

test("el período sugerido siempre cubre la fecha que lo originó", () => {
  for (const [dia, hora] of [
    ["2026-08-12", "20:00"],
    ["2026-09-19", "21:00"],
    ["2026-12-31", "23:30"],
    ["2027-01-01", "00:30"],
  ] as const) {
    const p = planEventEdit(ACTUAL, { lugar: "X", date: instanteDe(dia, hora), guests: 110 }, DOS);
    assert.equal(p.tipo, "falta-periodo", `${dia} tendría que no tener período`);
    if (p.tipo !== "falta-periodo") continue;
    assert.equal(cubreDia(p.sugerido, dia), true, `el sugerido para ${dia} no lo cubre`);
  }
});

// --- Nunca un destino que no sirva --------------------------------------------

test("el plan nunca deja el evento en un período que no cubre su fecha", () => {
  // Todo agosto contra dos períodos reales: o se guarda en uno que cubre la
  // fecha, o pide crear uno. Nunca devuelve un destino que no sirva.
  for (let dia = 1; dia <= 31; dia++) {
    const iso = `2026-08-${String(dia).padStart(2, "0")}`;
    const p = planEventEdit(ACTUAL, { lugar: `X${dia}`, date: instanteDe(iso, "20:00"), guests: 110 }, DOS);
    if (p.tipo === "guardar") {
      const destino = DOS.find((x) => x.id === p.destinoId)!;
      assert.equal(cubreDia(destino, iso), true, `el ${iso} quedó en un período que no lo cubre`);
    } else {
      assert.equal(p.tipo, "falta-periodo", `el ${iso} devolvió ${p.tipo}`);
    }
  }
});

test("con períodos superpuestos, todo día ambiguo se pregunta y ninguno se decide solo", () => {
  for (let dia = 12; dia <= 20; dia++) {
    const iso = `2026-08-${String(dia).padStart(2, "0")}`;
    const cuantos = SUPERPUESTOS.filter((x) => cubreDia(x, iso)).length;
    const p = planEventEdit(
      { ...ACTUAL, periodId: "otro", periodLabel: "Otro" },
      { lugar: `X${dia}`, date: instanteDe(iso, "20:00"), guests: 110 },
      SUPERPUESTOS
    );
    const esperado = cuantos === 0 ? "falta-periodo" : cuantos === 1 ? "guardar" : "elegir-periodo";
    assert.equal(p.tipo, esperado, `el ${iso} lo cubren ${cuantos} y devolvió ${p.tipo}`);
  }
});

test("ubicarDia y planEventEdit cuentan la misma historia", () => {
  // Si alguien agrega un desempate en period-fit, el plan lo heredaría sin que
  // ninguna prueba del plan se entere. Esta las ata.
  const u = ubicarDia(SUPERPUESTOS, "2026-08-15");
  assert.equal(u.tipo, "varios");
  const p = planEventEdit(
    { ...ACTUAL, periodId: "otro", periodLabel: "Otro" },
    { lugar: "X", date: instanteDe("2026-08-15", "20:00"), guests: 110 },
    SUPERPUESTOS
  );
  assert.equal(p.tipo, "elegir-periodo");
});

// ---------------------------------------------------------------------------
// Contra la base: el pedido no se toca
// ---------------------------------------------------------------------------

const DB = path.join(os.tmpdir(), `didier-test-evento-${process.pid}.db`);
let prisma: import("../app/generated/prisma/client").PrismaClient;
let notify: typeof import("../lib/notify");
let ids: { admin: string; armador: string; logistica: string; pA: string; pB: string; evento: string };

before(async () => {
  fs.rmSync(DB, { force: true });
  // Antes de importar nada que use la base: `lib/db` arma su cliente al
  // cargarse, y sin esto la prueba escribiría en la base de desarrollo.
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

  const pa = await prisma.operationalPeriod.create({
    data: { label: "Del 14 al 15", startDay: "2026-08-14", endDay: "2026-08-15" },
  });
  const pb = await prisma.operationalPeriod.create({
    data: { label: "Del 22 al 23", startDay: "2026-08-22", endDay: "2026-08-23" },
  });
  const ev = await prisma.event.create({
    data: { periodId: pa.id, lugar: "El Carmen", date: instanteDe("2026-08-15", "18:00"), guests: 110 },
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

  ids = { admin: admin.id, armador: armador.id, logistica: logistica.id, pA: pa.id, pB: pb.id, evento: ev.id };
  ENRIQUE.id = armador.id;
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

/** Huella del pedido, línea por línea, para comparar antes y después. */
async function fotoDelPedido(eventId: string) {
  const lineas = await prisma.orderLine.findMany({ where: { eventId }, orderBy: { id: "asc" } });
  return lineas.map((l) => ({
    id: l.id,
    productId: l.productId,
    customName: l.customName,
    customUnit: l.customUnit,
    customCategory: l.customCategory,
    qty: l.qty,
    note: l.note,
  }));
}

/** Lo que hace `updateEvent` al guardar, sin el `revalidatePath` de Next. */
async function guardar(
  eventId: string,
  actor: { id: string; name: string },
  pedido: { lugar: string; date: Date; guests: number; periodoElegidoId?: string | null }
) {
  const ev = (await prisma.event.findUnique({
    where: { id: eventId },
    include: { period: { select: { id: true, label: true, startDay: true, endDay: true } } },
  }))!;
  const periodos = await prisma.operationalPeriod.findMany({
    where: { deletedAt: null },
    select: { id: true, label: true, startDay: true, endDay: true },
  });
  const plan = planEventEdit(
    {
      lugar: ev.lugar,
      date: ev.date,
      guests: ev.guests,
      periodId: ev.periodId,
      periodLabel: ev.period.label ?? "",
    },
    pedido,
    periodos
  );
  if (plan.tipo !== "guardar") return plan;
  await prisma.event.update({
    where: { id: ev.id },
    data: {
      lugar: pedido.lugar.trim(),
      date: pedido.date,
      guests: Math.max(0, Math.round(pedido.guests)),
      periodId: plan.destinoId,
    },
  });
  // Se avisa DESPUÉS de guardar, para que el aviso nombre al evento corregido.
  await notify.notifyOrderChange(actor, ev.id, plan.cambios);
  return plan;
}

/** Quien corrige en casi todas las pruebas de acá. Su id se completa en `before`. */
const ENRIQUE = { id: "", name: "Enrique" };

test("el pedido queda exactamente igual después de corregir nombre y fecha", async () => {
  const antes = await fotoDelPedido(ids.evento);
  assert.equal(antes.length, 3);

  const plan = await guardar(ids.evento, ENRIQUE, {
    lugar: "El Carmen Center",
    date: instanteDe("2026-08-22", "18:00"),
    guests: 110,
  });
  assert.equal(plan.tipo, "guardar");

  const despues = await fotoDelPedido(ids.evento);
  assert.deepEqual(despues, antes, "alguna línea cambió, se perdió o se duplicó");
});

test("el evento se mudó de período conservando su identificador", async () => {
  const ev = (await prisma.event.findUnique({ where: { id: ids.evento } }))!;
  assert.equal(ev.id, ids.evento, "corregir no puede recrear el evento");
  assert.equal(ev.periodId, ids.pB);
  assert.equal(ev.lugar, "El Carmen Center");
  assert.equal(diaDe(ev.date), "2026-08-22");
});

test("el pedido ahora pesa en el período nuevo y ya no en el viejo", async () => {
  const enPeriodo = async (periodId: string) =>
    (await prisma.orderLine.findMany({ where: { event: { periodId, deletedAt: null } } })).reduce(
      (n, l) => n + l.qty,
      0
    );
  assert.equal(await enPeriodo(ids.pA), 0, "el período de origen todavía cuenta el pedido");
  assert.equal(await enPeriodo(ids.pB), 80 + 15 + 12, "el período de destino no cuenta el pedido");
});

test("no se tocó el responsable ni el estado", async () => {
  const ev = (await prisma.event.findUnique({ where: { id: ids.evento } }))!;
  assert.equal(ev.responsable, null);
  assert.equal(ev.status, "NO_LISTO");
  assert.equal(ev.deletedAt, null);
});

test("no se tocó el stock ni sus movimientos", async () => {
  assert.equal(await prisma.stockMovement.count(), 0);
  const copa = await prisma.product.findFirst({ where: { name: "Copa de agua" } });
  assert.equal(copa?.stock, 100);
  const bandeja = await prisma.product.findFirst({ where: { name: "Bandeja mozo" } });
  assert.equal(bandeja?.stock, 20);
});

test("el historial guarda qué cambió, con el antes, el después y quién lo hizo", async () => {
  const cambios = await prisma.orderChange.findMany({
    where: { eventId: ids.evento },
    orderBy: { createdAt: "asc" },
  });
  const porTipo = new Map(cambios.map((c) => [c.kind, c]));

  const nombre = porTipo.get("LUGAR")!;
  assert.equal(nombre.before, "El Carmen");
  assert.equal(nombre.after, "El Carmen Center");
  assert.equal(nombre.actorName, "Enrique");
  assert.equal(nombre.actorId, ids.armador);
  assert.ok(nombre.createdAt instanceof Date);

  const fecha = porTipo.get("FECHA")!;
  assert.match(fecha.before!, /15\/8/);
  assert.match(fecha.after!, /22\/8/);

  const mudanza = porTipo.get("PERIODO")!;
  assert.equal(mudanza.before, "Del 14 al 15");
  assert.equal(mudanza.after, "Del 22 al 23");
});

test("el historial no inventó cambios que nadie hizo", async () => {
  const kinds = (await prisma.orderChange.findMany({ where: { eventId: ids.evento } })).map((c) => c.kind);
  assert.deepEqual([...kinds].sort(), ["FECHA", "LUGAR", "PERIODO"]);
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

test("guardar de nuevo lo mismo no escribe ni avisa", async () => {
  const cambiosAntes = await prisma.orderChange.count({ where: { eventId: ids.evento } });
  const avisosAntes = await prisma.notification.count({ where: { type: "ORDER_EDIT" } });
  const plan = await guardar(ids.evento, ENRIQUE, {
    lugar: "  El Carmen Center  ",
    date: instanteDe("2026-08-22", "18:00"),
    guests: 110,
  });
  assert.equal(plan.tipo, "sin-cambios");
  assert.equal(await prisma.orderChange.count({ where: { eventId: ids.evento } }), cambiosAntes);
  assert.equal(await prisma.notification.count({ where: { type: "ORDER_EDIT" } }), avisosAntes);
});

test("las versiones guardadas no se tocan al corregir un evento", async () => {
  assert.equal(await prisma.periodVersion.count(), 0);
  assert.equal(await prisma.periodSnapshot.count(), 0);
});

test("corregir un evento sin pedido tampoco rompe nada", async () => {
  const vacio = await prisma.event.create({
    data: { periodId: ids.pA, lugar: "Sin pedido", date: instanteDe("2026-08-15", "20:00"), guests: 0 },
  });
  const plan = await guardar(vacio.id, { id: ids.admin, name: "Ana" }, {
    lugar: "Renombrado",
    date: instanteDe("2026-08-15", "20:00"),
    guests: 50,
  });
  assert.equal(plan.tipo, "guardar");
  const ev = (await prisma.event.findUnique({ where: { id: vacio.id } }))!;
  assert.equal(ev.lugar, "Renombrado");
  assert.equal(ev.guests, 50);
  assert.equal(ev.periodId, ids.pA, "sin cambiar la fecha no se muda");
  assert.equal(await prisma.orderLine.count({ where: { eventId: vacio.id } }), 0);
});

// --- Superposición contra la base: se pregunta y no se escribe nada ------------

test("con dos períodos que cubren la fecha, la corrección se frena y no escribe nada", async () => {
  // Se agrega un período que se superpone con el del evento. Desde acá, toda
  // corrección de este evento tiene que pedir que se elija.
  await prisma.operationalPeriod.create({
    data: { label: "Semana larga", startDay: "2026-08-20", endDay: "2026-08-25" },
  });

  const antesEv = (await prisma.event.findUnique({ where: { id: ids.evento } }))!;
  const cambiosAntes = await prisma.orderChange.count({ where: { eventId: ids.evento } });
  const avisosAntes = await prisma.notification.count({ where: { type: "ORDER_EDIT" } });
  const pedidoAntes = await fotoDelPedido(ids.evento);

  const plan = await guardar(ids.evento, ENRIQUE, {
    lugar: "El Carmen Salón",
    date: instanteDe("2026-08-22", "18:00"),
    guests: 110,
  });
  assert.equal(plan.tipo, "elegir-periodo");

  const despuesEv = (await prisma.event.findUnique({ where: { id: ids.evento } }))!;
  assert.equal(despuesEv.lugar, antesEv.lugar, "se guardó el nombre nuevo sin haber resuelto el período");
  assert.equal(despuesEv.periodId, antesEv.periodId);
  assert.equal(await prisma.orderChange.count({ where: { eventId: ids.evento } }), cambiosAntes);
  assert.equal(await prisma.notification.count({ where: { type: "ORDER_EDIT" } }), avisosAntes);
  assert.deepEqual(await fotoDelPedido(ids.evento), pedidoAntes);
});

test("elegido el período, la corrección se guarda; si el elegido no cubre la fecha, se rechaza", async () => {
  const pedidoAntes = await fotoDelPedido(ids.evento);

  // Primero el rechazo: el período del 14 al 15 no incluye al evento del 22.
  const malo = await guardar(ids.evento, ENRIQUE, {
    lugar: "El Carmen Salón",
    date: instanteDe("2026-08-22", "18:00"),
    guests: 110,
    periodoElegidoId: ids.pA,
  });
  assert.equal(malo.tipo, "error");
  assert.equal((await prisma.event.findUnique({ where: { id: ids.evento } }))!.lugar, "El Carmen Center");

  // Y ahora la elección válida: el que ya tenía. Se guarda el nombre y no se muda.
  const bueno = await guardar(ids.evento, ENRIQUE, {
    lugar: "El Carmen Salón",
    date: instanteDe("2026-08-22", "18:00"),
    guests: 110,
    periodoElegidoId: ids.pB,
  });
  assert.equal(bueno.tipo, "guardar");
  if (bueno.tipo !== "guardar") return;
  assert.equal(bueno.semudó, false);
  const ev = (await prisma.event.findUnique({ where: { id: ids.evento } }))!;
  assert.equal(ev.lugar, "El Carmen Salón");
  assert.equal(ev.periodId, ids.pB);
  assert.deepEqual(await fotoDelPedido(ids.evento), pedidoAntes, "elegir el período tocó el pedido");
});

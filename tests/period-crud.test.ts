import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";

import { diaDe, diaSemana, fmtRangoDias } from "../lib/dates";
import { instanteDe } from "../lib/dates";
import {
  duplicadoDe,
  duracion,
  eventosQueQuedanFuera,
  nombreDe,
  problemaDeRango,
  rangoQueLosContiene,
  type Periodo,
} from "../lib/period-fit";
import * as permisos from "../lib/permissions";
import { ROLES, canManagePeriods } from "../lib/permissions";

/**
 * La gestión de períodos operativos contra la base de verdad.
 *
 * Un período agrupa los eventos que comparten la misma vajilla. Todo lo que se
 * protege acá termina en el mismo lugar: **qué eventos cuentan contra qué
 * stock**. Un período con el rango mal guardado, un evento que quedó colgado
 * fuera de su período o un pedido que no volvió de la papelera no se ven el día
 * que pasan: se ven el día del evento, cuando falta la vajilla.
 *
 * Tres reglas que este archivo no deja retroceder:
 *
 *  1. **El rango es libre.** El modelo viejo se llamaba "fin de semana" y
 *     suponía viernes a domingo. Acá se crean períodos de un solo martes, de
 *     lunes a miércoles, de jueves a domingo y de una semana entera, y cada uno
 *     tiene que quedar guardado tal cual se pidió.
 *  2. **Achicar un período no puede dejar eventos afuera.** Si quedan, no se
 *     guarda nada — ni las fechas ni el nombre — y se devuelve quiénes son y el
 *     rango mínimo que sí los contiene.
 *  3. **La papelera no destruye.** El período se va con sus eventos y sus
 *     pedidos, y vuelve entero, con las mismas líneas y los mismos faltantes.
 *
 * Nota sobre las server actions: `app/actions/period.ts` llama a
 * `revalidatePath` y a `getSessionUser` (que lee cookies), y las dos revientan
 * fuera de una petición de Next. Acá se usa la lógica de producción
 * (`lib/period-fit`) y se replica el pegamento de Prisma, igual que hace
 * `tests/event-edit.test.ts`. Lo único que no se puede ejercitar así —que cada
 * acción llame a la comprobación de permiso— se cuida con una prueba sobre el
 * propio texto del archivo, más abajo.
 */

// ---------------------------------------------------------------------------
// Permisos: la matriz completa, sin base
// ---------------------------------------------------------------------------

const PUEDE_GESTIONAR_PERIODOS = { ADMIN: true, ARMADOR: true, LOGISTICA: false } as const;

for (const rol of Object.keys(PUEDE_GESTIONAR_PERIODOS) as (keyof typeof PUEDE_GESTIONAR_PERIODOS)[]) {
  test(`${rol}: puede crear, editar y borrar períodos = ${PUEDE_GESTIONAR_PERIODOS[rol]}`, () => {
    assert.equal(canManagePeriods(rol), PUEDE_GESTIONAR_PERIODOS[rol]);
  });
}

test("la matriz cubre todos los roles: si mañana se agrega uno, esta prueba falla", () => {
  assert.deepEqual([...ROLES].sort(), Object.keys(PUEDE_GESTIONAR_PERIODOS).sort());
});

test("a LOGISTICA no se le abrió ningún permiso nuevo: sigue teniendo exactamente los tres de siempre", () => {
  // Se barren TODAS las capacidades exportadas, no una lista escrita a mano: si
  // alguien agrega un permiso nuevo y se lo concede al encargado de logística
  // "para que pueda ayudar", esta prueba lo dice. Él mira todo, manda
  // sugerencias y cambia el responsable de la fiesta. Nada más.
  const CONCEDIDOS = ["canSetResponsable", "canView", "canSendSuggestions"];
  const capacidades = Object.keys(permisos)
    .filter((k) => k.startsWith("can") && typeof (permisos as Record<string, unknown>)[k] === "function")
    .sort();
  assert.ok(capacidades.length >= CONCEDIDOS.length, "no se encontró ninguna capacidad para revisar");

  const enTrue = capacidades.filter((k) =>
    (permisos as unknown as Record<string, (r: string) => boolean>)[k]("LOGISTICA")
  );
  assert.deepEqual(enTrue.sort(), [...CONCEDIDOS].sort());
});

test("un rol inventado o vacío no gestiona períodos", () => {
  // El rol llega de la sesión como texto: una cookie vieja o un rol borrado no
  // pueden caer en "permitido por defecto".
  assert.equal(canManagePeriods("SUPERUSUARIO"), false);
  assert.equal(canManagePeriods("admin"), false, "el rol se compara exacto, no sin mayúsculas");
  assert.equal(canManagePeriods(""), false);
});

test("ninguna acción de períodos escribe en la base sin haber comprobado el permiso antes", () => {
  // Esta es la única forma de cuidar la barrera real sin levantar Next: se lee
  // el archivo de acciones y se exige que toda función exportada que escriba
  // haya llamado a la comprobación ANTES de la primera escritura. Si alguien
  // agrega una acción nueva y se olvida del permiso, o la comprueba después de
  // guardar, esto falla. Esconder el botón no es un permiso.
  const fuente = fs.readFileSync(archivoDeAcciones(), "utf8");
  const ESCRITURA = /prisma\.\w+\.(create|update|delete|upsert|createMany|updateMany|deleteMany)\(|prisma\.\$transaction\(/;
  const PERMISO = /requireManage\(\)|canSetResponsable\(|canManagePeriods\(/;

  const cortes = [...fuente.matchAll(/^export async function (\w+)/gm)];
  assert.ok(cortes.length >= 8, `se esperaban las acciones de períodos y eventos, se encontraron ${cortes.length}`);

  for (let i = 0; i < cortes.length; i++) {
    const nombre = cortes[i][1];
    const desde = cortes[i].index!;
    const hasta = i + 1 < cortes.length ? cortes[i + 1].index! : fuente.length;
    const cuerpo = fuente.slice(desde, hasta);

    const escritura = cuerpo.search(ESCRITURA);
    if (escritura === -1) continue; // solo lee: no hay nada que custodiar
    const permiso = cuerpo.search(PERMISO);
    assert.notEqual(permiso, -1, `${nombre} escribe en la base sin comprobar ningún permiso`);
    assert.ok(permiso < escritura, `${nombre} comprueba el permiso DESPUÉS de escribir`);
  }
});

/** Ubica `app/actions/period.ts` sin depender de desde dónde se corra la prueba. */
function archivoDeAcciones(): string {
  let dir = process.cwd();
  for (let i = 0; i < 5; i++) {
    const candidato = path.join(dir, "app", "actions", "period.ts");
    if (fs.existsSync(candidato)) return candidato;
    dir = path.dirname(dir);
  }
  throw new Error("no se encontró app/actions/period.ts desde " + process.cwd());
}

// ---------------------------------------------------------------------------
// La base descartable
// ---------------------------------------------------------------------------

const DB = path.join(os.tmpdir(), `didier-test-periodos-${process.pid}.db`);
let prisma: import("../app/generated/prisma/client").PrismaClient;
let eventShortages: typeof import("../lib/shortages").eventShortages;
let productos: { copa: string; silla: string };

before(async () => {
  fs.rmSync(DB, { force: true });
  // ANTES de importar nada que use la base: `lib/db` arma su cliente al
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
  ({ eventShortages } = await import("../lib/shortages"));

  const copa = await prisma.product.create({
    data: { name: "Copa de agua", category: "ENSERES", type: "REUTILIZABLE", unit: "Unidad", stock: 100 },
  });
  const silla = await prisma.product.create({
    data: { name: "Silla Tiffany", category: "MOBILIARIO", type: "REUTILIZABLE", unit: "Unidad", stock: 50 },
  });
  productos = { copa: copa.id, silla: silla.id };
});

after(async () => {
  await prisma?.$disconnect();
  for (const f of [DB, `${DB}-wal`, `${DB}-shm`, `${DB}-journal`]) {
    try {
      fs.rmSync(f, { force: true });
    } catch {
      /* en Windows el archivo puede quedar tomado; se lo lleva el sistema */
    }
  }
});

// ---------------------------------------------------------------------------
// Lo que hacen las acciones, sin el `revalidatePath` ni la sesión de Next.
// Las REGLAS son las de producción (lib/period-fit); acá solo se replica el
// pegamento de Prisma.
// ---------------------------------------------------------------------------

type ResultadoPeriodo = {
  ok: boolean;
  error?: string;
  id?: string;
  duplicado?: { id: string; nombre: string };
  eventosFuera?: { id: string; lugar: string; dia: string }[];
  rangoSugerido?: { startDay: string; endDay: string; label: string };
};

/** Por qué falló, para que el mensaje de una prueba rota diga algo y no `undefined`. */
function porQue(r: ResultadoPeriodo): string {
  if (r.error) return r.error;
  if (r.duplicado) return `avisó duplicado de "${r.duplicado.nombre}"`;
  if (r.eventosFuera) return `dejaba afuera a ${r.eventosFuera.map((e) => e.lugar).join(", ")}`;
  return JSON.stringify(r);
}

async function periodosVivos(): Promise<Periodo[]> {
  return prisma.operationalPeriod.findMany({
    where: { deletedAt: null },
    select: { id: true, label: true, startDay: true, endDay: true },
    orderBy: { startDay: "desc" },
  });
}

/** Réplica de `createPeriod`. */
async function crearPeriodo(input: {
  label?: string;
  startDay: string;
  endDay: string;
  permitirDuplicado?: boolean;
}): Promise<ResultadoPeriodo> {
  const startDay = (input.startDay ?? "").trim();
  const endDay = (input.endDay ?? "").trim();
  const problema = problemaDeRango(startDay, endDay);
  if (problema) return { ok: false, error: problema };

  const igual = duplicadoDe(await periodosVivos(), startDay, endDay);
  if (igual && !input.permitirDuplicado) return { ok: false, duplicado: { id: igual.id, nombre: nombreDe(igual) } };

  const p = await prisma.operationalPeriod.create({
    data: { label: input.label?.trim() || null, startDay, endDay },
  });
  return { ok: true, id: p.id };
}

/** Réplica de `updatePeriod`. */
async function editarPeriodo(input: {
  periodId: string;
  label?: string;
  startDay: string;
  endDay: string;
  permitirDuplicado?: boolean;
}): Promise<ResultadoPeriodo> {
  const startDay = (input.startDay ?? "").trim();
  const endDay = (input.endDay ?? "").trim();
  const problema = problemaDeRango(startDay, endDay);
  if (problema) return { ok: false, error: problema };

  const p = await prisma.operationalPeriod.findUnique({
    where: { id: input.periodId },
    include: { events: { where: { deletedAt: null }, select: { id: true, lugar: true, date: true } } },
  });
  if (!p) return { ok: false, error: "No se encontró el período." };
  if (p.deletedAt) return { ok: false, error: "Ese período está en la papelera." };

  const igual = duplicadoDe(await periodosVivos(), startDay, endDay, p.id);
  if (igual && !input.permitirDuplicado) return { ok: false, duplicado: { id: igual.id, nombre: nombreDe(igual) } };

  const fuera = eventosQueQuedanFuera(p.events, startDay, endDay);
  if (fuera.length > 0) {
    const minimo = rangoQueLosContiene(p.events)!;
    return {
      ok: false,
      eventosFuera: fuera.map((e) => ({ id: e.id, lugar: e.lugar, dia: diaDe(e.date) })),
      rangoSugerido: { ...minimo, label: fmtRangoDias(minimo.startDay, minimo.endDay) },
    };
  }

  await prisma.operationalPeriod.update({
    where: { id: p.id },
    data: { startDay, endDay, label: input.label?.trim() || null },
  });
  return { ok: true, id: p.id };
}

/** Réplica de `deletePeriod`. */
async function borrarPeriodo(periodId: string): Promise<ResultadoPeriodo> {
  const p = await prisma.operationalPeriod.findUnique({ where: { id: periodId }, select: { deletedAt: true } });
  if (!p) return { ok: false, error: "No se encontró el período." };
  if (p.deletedAt) return { ok: true };
  await prisma.operationalPeriod.update({ where: { id: periodId }, data: { deletedAt: new Date() } });
  return { ok: true };
}

/** Réplica de `restorePeriod`. */
async function recuperarPeriodo(periodId: string): Promise<ResultadoPeriodo> {
  const p = await prisma.operationalPeriod.findUnique({ where: { id: periodId }, select: { id: true } });
  if (!p) return { ok: false, error: "No se encontró el período." };
  await prisma.operationalPeriod.update({ where: { id: periodId }, data: { deletedAt: null } });
  return { ok: true, id: periodId };
}

/** Réplica de `restoreEvent`: si el período también estaba borrado, vuelve con él. */
async function recuperarEvento(eventId: string): Promise<ResultadoPeriodo> {
  const ev = await prisma.event.findUnique({
    where: { id: eventId },
    select: { periodId: true, period: { select: { deletedAt: true } } },
  });
  if (!ev) return { ok: false, error: "No se encontró el evento." };
  await prisma.$transaction([
    prisma.event.update({ where: { id: eventId }, data: { deletedAt: null } }),
    ...(ev.period.deletedAt
      ? [prisma.operationalPeriod.update({ where: { id: ev.periodId }, data: { deletedAt: null } })]
      : []),
  ]);
  return { ok: true, id: ev.periodId };
}

/** El período tal cual quedó guardado. */
async function leer(periodId: string) {
  return (await prisma.operationalPeriod.findUnique({ where: { id: periodId } }))!;
}

/** Huella completa de un período: sus eventos con sus pedidos, línea por línea.
 *  Es lo que tiene que sobrevivir intacto al viaje a la papelera y de vuelta. */
async function fotoDelPeriodo(periodId: string) {
  const eventos = await prisma.event.findMany({
    where: { periodId },
    orderBy: { id: "asc" },
    include: { lines: { orderBy: { id: "asc" } } },
  });
  return eventos.map((e) => ({
    id: e.id,
    lugar: e.lugar,
    dia: diaDe(e.date),
    guests: e.guests,
    responsable: e.responsable,
    status: e.status,
    enPapelera: e.deletedAt !== null,
    lineas: e.lines.map((l) => ({
      id: l.id,
      productId: l.productId,
      customName: l.customName,
      customCategory: l.customCategory,
      customUnit: l.customUnit,
      qty: l.qty,
      note: l.note,
    })),
  }));
}

// ---------------------------------------------------------------------------
// Crear: el rango es libre. Ninguno empieza viernes ni dura siete días "porque sí".
// ---------------------------------------------------------------------------

test("un período de un solo martes se guarda como un solo martes", async () => {
  // El caso que el modelo viejo no sabía representar: en los datos reales ya
  // había un período de un martes suelto.
  const r = await crearPeriodo({ startDay: "2026-08-18", endDay: "2026-08-18" });
  assert.equal(r.ok, true, porQue(r));
  const p = await leer(r.id!);
  assert.equal(p.startDay, "2026-08-18");
  assert.equal(p.endDay, "2026-08-18", "el fin no puede estirarse solo");
  assert.equal(duracion(p), 1);
  assert.equal(diaSemana(p.startDay), 2, "2026-08-18 es martes");
});

test("los rangos se guardan tal cual: empiecen el día que empiecen y duren lo que duren", async () => {
  const casos = [
    { nombre: "lunes a miércoles", startDay: "2026-08-17", endDay: "2026-08-19", dias: 3 },
    { nombre: "jueves a domingo", startDay: "2026-08-20", endDay: "2026-08-23", dias: 4 },
    { nombre: "una semana entera arrancando un miércoles", startDay: "2026-08-26", endDay: "2026-09-01", dias: 7 },
    { nombre: "de fin de año, cruzando de 2026 a 2027", startDay: "2026-12-26", endDay: "2027-01-01", dias: 7 },
  ];

  const arranques = new Set<number>();
  for (const c of casos) {
    const r = await crearPeriodo({ startDay: c.startDay, endDay: c.endDay });
    assert.equal(r.ok, true, `${c.nombre}: ${porQue(r)}`);
    const p = await leer(r.id!);
    // Si alguien vuelve a normalizar el rango a "el finde que lo contiene",
    // estas tres líneas se caen para tres de los cuatro casos.
    assert.equal(p.startDay, c.startDay, `${c.nombre}: se movió el inicio`);
    assert.equal(p.endDay, c.endDay, `${c.nombre}: se movió el fin`);
    assert.equal(duracion(p), c.dias, `${c.nombre}: cambió la duración`);
    arranques.add(diaSemana(p.startDay));
  }

  // Cuatro días de la semana distintos, y ninguno de ellos es viernes: el
  // período no tiene un día de arranque privilegiado.
  assert.equal(arranques.size, 4, "los casos tienen que arrancar en días distintos");
  assert.equal(arranques.has(5), false, "ningún caso arranca viernes, y ninguno debería necesitarlo");
});

test("un período con las fechas al revés o con un día que no existe no crea nada", async () => {
  const antes = await prisma.operationalPeriod.count();
  for (const [startDay, endDay] of [
    ["2026-08-19", "2026-08-17"], // fin antes que el inicio
    ["2026-02-30", "2026-03-02"], // febrero no tiene 30
    ["", "2026-08-19"],
    ["2026-8-17", "2026-08-19"], // sin cero adelante rompe la comparación por texto
  ] as const) {
    const r = await crearPeriodo({ startDay, endDay });
    assert.equal(r.ok, false, `"${startDay}" a "${endDay}" no debería crearse`);
    assert.ok(r.error, "un rechazo sin motivo no le sirve a nadie");
  }
  assert.equal(await prisma.operationalPeriod.count(), antes, "se guardó algún período inválido");
});

// ---------------------------------------------------------------------------
// El nombre es opcional
// ---------------------------------------------------------------------------

test("sin nombre, el período se muestra por su rango de fechas", async () => {
  const r = await crearPeriodo({ startDay: "2026-07-06", endDay: "2026-07-08" });
  assert.equal(r.ok, true, porQue(r));
  const p = await leer(r.id!);
  assert.equal(p.label, null, "el nombre vacío se guarda como null, nunca como cadena vacía");
  const mostrado = nombreDe(p);
  assert.match(mostrado, /6/);
  assert.match(mostrado, /8 jul/);
});

test("ponerle nombre y después vaciarlo lo devuelve a mostrarse por el rango", async () => {
  // Un nombre en blanco guardado como "" dejaría la tarjeta sin título: ni
  // nombre ni fechas. Vaciarlo tiene que volver al rango.
  const { id } = await crearPeriodo({ startDay: "2026-07-13", endDay: "2026-07-15" });
  const conNombre = await editarPeriodo({
    periodId: id!,
    label: "  Semana de la vendimia  ",
    startDay: "2026-07-13",
    endDay: "2026-07-15",
  });
  assert.equal(conNombre.ok, true, porQue(conNombre));
  let p = await leer(id!);
  assert.equal(p.label, "Semana de la vendimia", "el nombre se guarda sin los espacios de los costados");
  assert.equal(nombreDe(p), "Semana de la vendimia");

  const vaciado = await editarPeriodo({ periodId: id!, label: "   ", startDay: "2026-07-13", endDay: "2026-07-15" });
  assert.equal(vaciado.ok, true, porQue(vaciado));
  p = await leer(id!);
  assert.equal(p.label, null);
  assert.notEqual(nombreDe(p).trim(), "", "un período sin nombre no puede quedar sin nada que mostrar");
  assert.match(nombreDe(p), /jul/);
});

test("cambiar las fechas sin tocar el nombre lo conserva", async () => {
  const { id } = await crearPeriodo({ label: "Aniversario del club", startDay: "2026-07-20", endDay: "2026-07-21" });
  const r = await editarPeriodo({
    periodId: id!,
    label: "Aniversario del club",
    startDay: "2026-07-20",
    endDay: "2026-07-23",
  });
  assert.equal(r.ok, true, porQue(r));
  const p = await leer(id!);
  assert.equal(p.label, "Aniversario del club");
  assert.equal(p.endDay, "2026-07-23");
  assert.equal(duracion(p), 4);
});

// ---------------------------------------------------------------------------
// LA validación: achicar no puede dejar eventos afuera
// ---------------------------------------------------------------------------

const OCT = { id: "", eA: "", eB: "", eC: "" };

test("se prepara un período con eventos repartidos, incluido uno de las 23", async () => {
  const r = await crearPeriodo({ label: "Semana de octubre", startDay: "2026-10-12", endDay: "2026-10-18" });
  assert.equal(r.ok, true, porQue(r));
  OCT.id = r.id!;

  const nuevo = async (lugar: string, dia: string, hora: string) =>
    (await prisma.event.create({ data: { periodId: OCT.id, lugar, date: instanteDe(dia, hora), guests: 100 } })).id;

  OCT.eA = await nuevo("Quinta Los Álamos", "2026-10-13", "21:00");
  // Las 23 del 16 en Argentina son las 02 del 17 en UTC: el evento trampa.
  OCT.eB = await nuevo("Club Náutico", "2026-10-16", "23:00");
  OCT.eC = await nuevo("Salón Belgrano", "2026-10-18", "13:00");

  assert.equal((await prisma.event.count({ where: { periodId: OCT.id } })), 3);
});

test("achicar el período dejando un evento afuera NO guarda nada", async () => {
  const antes = await leer(OCT.id);
  const r = await editarPeriodo({
    periodId: OCT.id,
    label: "Nombre nuevo que no debería quedar",
    startDay: "2026-10-14", // deja afuera al del 13
    endDay: "2026-10-18",
  });

  assert.equal(r.ok, false);
  assert.deepEqual(r.eventosFuera?.map((e) => e.id), [OCT.eA]);
  assert.equal(r.eventosFuera?.[0].lugar, "Quinta Los Álamos", "hay que poder reconocer cuál es sin buscarlo");
  assert.equal(r.eventosFuera?.[0].dia, "2026-10-13");

  // Y el arreglo que se ofrece: el rango mínimo que los contiene a todos.
  assert.equal(r.rangoSugerido?.startDay, "2026-10-13");
  assert.equal(r.rangoSugerido?.endDay, "2026-10-18");
  assert.ok(r.rangoSugerido?.label.trim(), "el rango sugerido tiene que poder mostrarse");

  // Contra la base: no se guardó NADA, ni siquiera el nombre nuevo. Guardar el
  // nombre y descartar las fechas dejaría el período a medio editar.
  const despues = await leer(OCT.id);
  assert.equal(despues.startDay, antes.startDay);
  assert.equal(despues.endDay, antes.endDay);
  assert.equal(despues.label, antes.label, "se guardó el nombre nuevo pese a haber rechazado el cambio");
  const ev = (await prisma.event.findUnique({ where: { id: OCT.eA } }))!;
  assert.equal(ev.periodId, OCT.id, "el evento que quedaba afuera no se puede mudar solo");
  assert.equal(ev.deletedAt, null, "y mucho menos borrarse");
});

test("el evento de las 23 se mide por su día argentino: no lo dan por afuera de más", async () => {
  // Achicar hasta el 16 inclusive. El evento del 16 a las 23 es del 17 en UTC:
  // si el día se leyera con la zona del proceso (Railway corre en UTC) se lo
  // reportaría como que queda afuera y el achique se rechazaría por nada.
  const r = await editarPeriodo({ periodId: OCT.id, startDay: "2026-10-12", endDay: "2026-10-16" });
  assert.equal(r.ok, false, "el del 18 sí queda afuera");
  assert.deepEqual(
    r.eventosFuera?.map((e) => e.id),
    [OCT.eC],
    "el del 16 a las 23 no queda afuera de un período que termina el 16"
  );
  assert.equal(r.rangoSugerido?.endDay, "2026-10-18");
});

test("el rango que se ofrece de arreglo sí se puede guardar, y deja a todos adentro", async () => {
  const r = await editarPeriodo({ periodId: OCT.id, startDay: "2026-10-13", endDay: "2026-10-18" });
  assert.equal(r.ok, true, porQue(r));
  const p = await leer(OCT.id);
  assert.equal(p.startDay, "2026-10-13");
  assert.equal(p.endDay, "2026-10-18");
  const eventos = await prisma.event.findMany({ where: { periodId: OCT.id, deletedAt: null } });
  assert.deepEqual(eventosQueQuedanFuera(eventos, p.startDay, p.endDay), []);
});

test("estirar el período nunca deja a nadie afuera", async () => {
  const r = await editarPeriodo({ periodId: OCT.id, startDay: "2026-10-01", endDay: "2026-10-31" });
  assert.equal(r.ok, true, porQue(r));
  assert.equal(duracion(await leer(OCT.id)), 31);
  // Y se vuelve al rango ajustado para las pruebas que siguen.
  assert.equal((await editarPeriodo({ periodId: OCT.id, startDay: "2026-10-13", endDay: "2026-10-18" })).ok, true);
});

test("un evento en la papelera no traba el achique, y su pedido sigue guardado", async () => {
  // El evento borrado no cuenta para nada: si contara, un evento cancelado hace
  // meses impediría para siempre ajustar las fechas del período.
  await prisma.orderLine.create({ data: { eventId: OCT.eC, productId: productos.copa, qty: 60, note: "las altas" } });
  await prisma.event.update({ where: { id: OCT.eC }, data: { deletedAt: new Date() } });

  const r = await editarPeriodo({ periodId: OCT.id, startDay: "2026-10-13", endDay: "2026-10-16" });
  assert.equal(r.ok, true, "un evento en la papelera no debería frenar el cambio de fechas");
  const p = await leer(OCT.id);
  assert.equal(p.endDay, "2026-10-16");

  const lineas = await prisma.orderLine.findMany({ where: { eventId: OCT.eC } });
  assert.equal(lineas.length, 1, "achicar el período borró el pedido de un evento de la papelera");
  assert.equal(lineas[0].qty, 60);
});

// ---------------------------------------------------------------------------
// Duplicados: avisa la primera vez, crea si se insiste
// ---------------------------------------------------------------------------

const NOV = { primero: "", otro: "" };

test("crear dos veces el mismo rango avisa en vez de crearlo", async () => {
  const uno = await crearPeriodo({ label: "Fiesta de egresados", startDay: "2026-11-06", endDay: "2026-11-08" });
  assert.equal(uno.ok, true, porQue(uno));
  NOV.primero = uno.id!;

  const dos = await crearPeriodo({ startDay: "2026-11-06", endDay: "2026-11-08" });
  assert.equal(dos.ok, false, "el doble toque no puede crear dos períodos iguales");
  assert.equal(dos.duplicado?.id, NOV.primero);
  assert.equal(dos.duplicado?.nombre, "Fiesta de egresados", "el aviso tiene que nombrar al que ya existe");
  assert.equal(dos.error, undefined, "esto no es un error: es una pregunta");
  assert.equal(
    await prisma.operationalPeriod.count({ where: { startDay: "2026-11-06", endDay: "2026-11-08" } }),
    1,
    "se creó igual pese a haber avisado"
  );
});

test("si se insiste, el duplicado se crea", async () => {
  // Dos períodos con el mismo rango es raro pero legítimo: la persona sabe por
  // qué los separa. El aviso es para que no pase de casualidad.
  const r = await crearPeriodo({
    label: "Fiesta de egresados (turno tarde)",
    startDay: "2026-11-06",
    endDay: "2026-11-08",
    permitirDuplicado: true,
  });
  assert.equal(r.ok, true, porQue(r));
  assert.equal(await prisma.operationalPeriod.count({ where: { startDay: "2026-11-06", endDay: "2026-11-08" } }), 2);
});

test("un rango que se superpone pero no es idéntico no es un duplicado", async () => {
  // La superposición está permitida a propósito: es la razón de que la app
  // pregunte a qué período va un evento en vez de decidirlo sola.
  const r = await crearPeriodo({ startDay: "2026-11-07", endDay: "2026-11-09" });
  assert.equal(r.ok, true, "un rango corrido un día es otro período, no una repetición");
});

test("mover un período justo encima del rango de otro avisa y no guarda", async () => {
  const otro = await crearPeriodo({ startDay: "2026-11-20", endDay: "2026-11-21" });
  assert.equal(otro.ok, true, porQue(otro));
  NOV.otro = otro.id!;

  const r = await editarPeriodo({ periodId: NOV.otro, startDay: "2026-11-06", endDay: "2026-11-08" });
  assert.equal(r.ok, false);
  assert.equal(r.duplicado?.id, NOV.primero);
  const p = await leer(NOV.otro);
  assert.equal(p.startDay, "2026-11-20", "se guardaron las fechas nuevas pese a haber avisado del duplicado");
  assert.equal(p.endDay, "2026-11-21");

  const insistiendo = await editarPeriodo({
    periodId: NOV.otro,
    startDay: "2026-11-06",
    endDay: "2026-11-08",
    permitirDuplicado: true,
  });
  assert.equal(insistiendo.ok, true, porQue(insistiendo));
  assert.equal((await leer(NOV.otro)).startDay, "2026-11-06");
});

test("guardar un período sin cambiarle las fechas no se toma como duplicado de sí mismo", async () => {
  // Sin esto, ponerle nombre a un período sería imposible: se avisaría duplicado
  // contra él mismo, para siempre.
  const propio = await crearPeriodo({ startDay: "2026-11-12", endDay: "2026-11-14" });
  assert.equal(propio.ok, true, porQue(propio));

  const r = await editarPeriodo({
    periodId: propio.id!,
    label: "Egresados 2026",
    startDay: "2026-11-12",
    endDay: "2026-11-14",
  });
  assert.equal(r.ok, true, porQue(r));
  assert.equal((await leer(propio.id!)).label, "Egresados 2026");
});

test("un período que está en la papelera no impide crear uno nuevo con su mismo rango", async () => {
  const viejo = await crearPeriodo({ startDay: "2026-11-27", endDay: "2026-11-28" });
  assert.equal(viejo.ok, true, porQue(viejo));
  assert.equal((await borrarPeriodo(viejo.id!)).ok, true);

  const nuevo = await crearPeriodo({ startDay: "2026-11-27", endDay: "2026-11-28" });
  assert.equal(nuevo.ok, true, "el aviso de duplicado solo mira los períodos vivos");
  assert.notEqual(nuevo.id, viejo.id);
});

// ---------------------------------------------------------------------------
// Papelera: se va entero y vuelve entero
// ---------------------------------------------------------------------------

const SEP = { id: "", eA: "", eB: "" };
let fotoAntes: Awaited<ReturnType<typeof fotoDelPeriodo>>;
let faltantesAntes: Awaited<ReturnType<typeof eventShortages>>;

test("se prepara un período con dos eventos, sus pedidos y faltantes de verdad", async () => {
  const r = await crearPeriodo({ label: "Semana de casamientos", startDay: "2026-09-14", endDay: "2026-09-20" });
  assert.equal(r.ok, true, porQue(r));
  SEP.id = r.id!;

  const a = await prisma.event.create({
    data: {
      periodId: SEP.id,
      lugar: "El Carmen",
      date: instanteDe("2026-09-18", "21:00"),
      guests: 180,
      responsable: "Pablo",
    },
  });
  const b = await prisma.event.create({
    data: { periodId: SEP.id, lugar: "Puerto", date: instanteDe("2026-09-19", "13:00"), guests: 90, status: "LISTO" },
  });
  SEP.eA = a.id;
  SEP.eB = b.id;

  // Entre los dos se pasan del stock: 120 copas contra 100, 55 sillas contra 50.
  await prisma.orderLine.create({ data: { eventId: a.id, productId: productos.copa, qty: 80, note: "las altas" } });
  await prisma.orderLine.create({ data: { eventId: a.id, productId: productos.silla, qty: 30 } });
  await prisma.orderLine.create({
    data: { eventId: a.id, customName: "Hielo", customCategory: "BEBIDA", customUnit: "Bolsa", qty: 12, note: "seco" },
  });
  await prisma.orderLine.create({ data: { eventId: b.id, productId: productos.copa, qty: 40 } });
  await prisma.orderLine.create({ data: { eventId: b.id, productId: productos.silla, qty: 25 } });

  fotoAntes = await fotoDelPeriodo(SEP.id);
  faltantesAntes = await eventShortages(SEP.eA);

  assert.equal(fotoAntes.length, 2);
  assert.equal(fotoAntes.reduce((n, e) => n + e.lineas.length, 0), 5);
  assert.equal(faltantesAntes?.rows.length, 2, "el escenario tiene que tener faltantes para que la vuelta signifique algo");
});

test("borrar el período lo saca de la vista, y sus eventos se van con él sin marcarse uno por uno", async () => {
  assert.equal((await borrarPeriodo(SEP.id)).ok, true);

  const p = await leer(SEP.id);
  assert.notEqual(p.deletedAt, null, "el período tiene que quedar marcado, no destruido");
  assert.equal((await periodosVivos()).some((x) => x.id === SEP.id), false, "sigue apareciendo entre los vivos");

  // Los eventos NO se marcan: van con el padre. Marcarlos uno por uno haría que
  // recuperar el período dejara adentro eventos borrados que nadie borró.
  const eventos = await prisma.event.findMany({ where: { periodId: SEP.id } });
  assert.equal(eventos.length, 2);
  assert.deepEqual(eventos.map((e) => e.deletedAt), [null, null]);
});

test("en la papelera, el pedido del período deja de pesar contra el stock", async () => {
  // Un período borrado que siguiera contando faltantes mandaría a comprar cosas
  // para eventos que ya no existen.
  assert.equal(await eventShortages(SEP.eA), null);
  assert.equal(await eventShortages(SEP.eB), null);
});

test("nada del pedido se destruyó al borrar: las líneas siguen todas ahí", async () => {
  const lineas = await prisma.orderLine.count({ where: { event: { periodId: SEP.id } } });
  assert.equal(lineas, 5);
});

test("borrar dos veces no vuelve a marcar nada ni rompe", async () => {
  const antes = (await leer(SEP.id)).deletedAt;
  const r = await borrarPeriodo(SEP.id);
  assert.equal(r.ok, true);
  assert.deepEqual((await leer(SEP.id)).deletedAt, antes, "el segundo borrado corrió la fecha del primero");
});

test("no se puede editar un período que está en la papelera", async () => {
  const r = await editarPeriodo({ periodId: SEP.id, startDay: "2026-09-14", endDay: "2026-09-15" });
  assert.equal(r.ok, false);
  assert.match(String(r.error), /papelera/i);
  assert.equal((await leer(SEP.id)).endDay, "2026-09-20", "se editó igual un período borrado");
});

test("recuperar el período lo devuelve entero: mismos eventos, mismas líneas, mismos faltantes", async () => {
  assert.equal((await recuperarPeriodo(SEP.id)).ok, true);

  const p = await leer(SEP.id);
  assert.equal(p.deletedAt, null);
  assert.equal(p.label, "Semana de casamientos");
  assert.equal(p.startDay, "2026-09-14");
  assert.equal(p.endDay, "2026-09-20");

  // La huella completa, línea por línea: si el viaje perdió, duplicó o cambió
  // una cantidad, una nota o un ítem suelto, esto se cae.
  assert.deepEqual(await fotoDelPeriodo(SEP.id), fotoAntes);
  // Y los faltantes se vuelven a calcular igual que antes de borrarlo.
  assert.deepEqual(await eventShortages(SEP.eA), faltantesAntes);
});

test("recuperar un evento cuyo período estaba en la papelera los saca a los dos", async () => {
  // Si volviera solo el evento, quedaría dentro de un período al que no se puede
  // entrar: recuperado en los datos e invisible en la app.
  assert.equal((await borrarPeriodo(SEP.id)).ok, true);
  await prisma.event.update({ where: { id: SEP.eB }, data: { deletedAt: new Date() } });

  assert.equal((await recuperarEvento(SEP.eB)).ok, true);
  assert.equal((await leer(SEP.id)).deletedAt, null, "el evento volvió a un período que sigue en la papelera");
  assert.equal((await prisma.event.findUnique({ where: { id: SEP.eB } }))!.deletedAt, null);
  assert.deepEqual(await fotoDelPeriodo(SEP.id), fotoAntes, "la ida y vuelta por el evento tocó el pedido");
});

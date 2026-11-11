import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { crearBaseDescartable } from "./helpers/base-descartable";
import { instanteDe } from "../lib/dates";

/**
 * Crear y corregir un evento, contra una base de verdad.
 *
 * Lo que se cuida:
 *  - crear un evento con un período nuevo es UNA cosa: si el evento no se crea,
 *    el período no queda (antes quedaba un período vacío);
 *  - dos toques a la vez no crean dos períodos iguales;
 *  - corregir un evento escribe solo si sigue vivo, y con el período que falta
 *    pasa lo mismo que al crear.
 */

const base = crearBaseDescartable("evento-db");
let prisma: typeof import("../lib/db").prisma;
let db: typeof import("../lib/evento-db");

before(async () => {
  ({ prisma } = await import("../lib/db"));
  db = await import("../lib/evento-db");
});

after(async () => {
  await prisma?.$disconnect();
  base.borrar();
});

const periodosDel = (dia: string) => prisma.operationalPeriod.findMany({ where: { startDay: dia, endDay: dia } });
const nuevo = (dia: string, extra: Partial<Parameters<typeof db.crearEventoUbicado>[0]> = {}) =>
  db.crearEventoUbicado({ lugar: "El Carmen", fecha: instanteDe(dia, "21:00"), invitados: 120, responsable: null, periodoElegidoId: null, crearPeriodo: false, ...extra });

// ---------------------------------------------------------------------------
// Crear
// ---------------------------------------------------------------------------

test("sin un período que cubra la fecha no crea nada y ofrece el de ese día", async () => {
  const r = await nuevo("2027-03-02");
  assert.equal(r.ok, false);
  assert.deepEqual(!r.ok && r.faltaPeriodo, { startDay: "2027-03-02", endDay: "2027-03-02", label: "Mar 2 mar" });
  assert.equal((await periodosDel("2027-03-02")).length, 0);
  assert.equal(await prisma.event.count(), 0);
});

test("confirmado, crea el período y el evento juntos, y el período nace marcado para avisar faltantes", async () => {
  const r = await nuevo("2027-03-02", { crearPeriodo: true, responsable: "Dante" });
  assert.equal(r.ok, true);
  const [p] = await periodosDel("2027-03-02");
  assert.ok(r.ok && r.periodId === p.id && r.periodoCreado);
  assert.ok(p.faltantesDesde instanceof Date, "un período nuevo sin faltantesDesde registra sus primeros faltantes en silencio");
  const ev = await prisma.event.findUniqueOrThrow({ where: { id: r.ok ? r.id : "" } });
  assert.deepEqual([ev.lugar, ev.guests, ev.responsable, ev.status, ev.periodId], ["El Carmen", 120, "Dante", "NO_LISTO", p.id]);
});

test("si el evento no se puede crear, el período que se había creado para él no queda", async () => {
  // Un lugar nulo viola el NOT NULL de la base: es la forma de hacer fallar la
  // creación del evento DESPUÉS de haber creado el período en la misma transacción.
  await assert.rejects(nuevo("2027-03-09", { crearPeriodo: true, lugar: null as unknown as string }));
  assert.equal((await periodosDel("2027-03-09")).length, 0, "quedó un período vacío de un evento que no se creó");
});

test("dos toques a la vez con 'crear el período' no crean dos períodos iguales", async () => {
  const [a, b] = await Promise.all([nuevo("2027-03-16", { crearPeriodo: true }), nuevo("2027-03-16", { crearPeriodo: true, lugar: "Puerto" })]);
  assert.ok(a.ok && b.ok);
  assert.equal((await periodosDel("2027-03-16")).length, 1, "cada toque creó su período");
  assert.ok(a.ok && b.ok && a.periodId === b.periodId);
  assert.equal([a, b].filter((r) => r.ok && r.periodoCreado).length, 1);
});

test("con varios períodos que cubren la fecha no elige solo; con el elegido, va a ese", async () => {
  const largo = await prisma.operationalPeriod.create({ data: { startDay: "2027-04-01", endDay: "2027-04-07" } });
  const corto = await prisma.operationalPeriod.create({ data: { startDay: "2027-04-03", endDay: "2027-04-03" } });
  const sinElegir = await nuevo("2027-04-03");
  assert.deepEqual(!sinElegir.ok && sinElegir.elegirPeriodo?.map((p) => p.id), [corto.id, largo.id]);
  const elegido = await nuevo("2027-04-03", { periodoElegidoId: largo.id });
  assert.ok(elegido.ok && elegido.periodId === largo.id && !elegido.periodoCreado);
  // Uno elegido que no cubre el día, o que está en la papelera, no sirve.
  const fuera = await nuevo("2027-04-20", { periodoElegidoId: largo.id });
  assert.match((!fuera.ok && fuera.error) || "", /no incluye el 2027-04-20/);
  await prisma.operationalPeriod.update({ where: { id: corto.id }, data: { deletedAt: new Date() } });
  const borrado = await nuevo("2027-04-03", { periodoElegidoId: corto.id });
  assert.equal(!borrado.ok && borrado.error, "No se encontró el período elegido.");
});

// ---------------------------------------------------------------------------
// Corregir
// ---------------------------------------------------------------------------

async function eventoEn(dia: string, lugar = "Museo") {
  const p = await prisma.operationalPeriod.create({ data: { startDay: dia, endDay: dia } });
  const e = await prisma.event.create({ data: { periodId: p.id, lugar, date: instanteDe(dia, "20:00"), guests: 80 } });
  return { periodo: p.id, evento: e.id };
}
const corregir = (eventId: string, dia: string, extra: Partial<Parameters<typeof db.corregirEvento>[0]> = {}) =>
  db.corregirEvento({ eventId, lugar: "Museo", fecha: instanteDe(dia, "20:00"), invitados: null, periodoElegidoId: null, crearPeriodo: false, ...extra });

test("corregir nombre e invitados guarda, dice qué cambió y no muda el evento", async () => {
  const e = await eventoEn("2027-05-04");
  const r = await corregir(e.evento, "2027-05-04", { lugar: "Museo de Arte", invitados: 95 });
  assert.ok(r.ok && !r.sinCambios);
  assert.deepEqual(r.ok && !r.sinCambios && [r.cambios.map((c) => c.kind), r.semudó, r.periodoAnterior], [["LUGAR", "INVITADOS"], false, e.periodo]);
  const ev = await prisma.event.findUniqueOrThrow({ where: { id: e.evento } });
  assert.deepEqual([ev.lugar, ev.guests, ev.periodId], ["Museo de Arte", 95, e.periodo]);
});

test("guardar sin cambiar nada no escribe: sin invitados se conservan los que tenía", async () => {
  const e = await eventoEn("2027-05-11");
  const r = await corregir(e.evento, "2027-05-11");
  assert.deepEqual(r, { ok: true, id: e.evento, sinCambios: true });
});

test("mover la fecha a un día sin período: primero pregunta, y confirmado crea el período y muda el evento", async () => {
  const e = await eventoEn("2027-05-18");
  const pregunta = await corregir(e.evento, "2027-05-25");
  assert.deepEqual(!pregunta.ok && pregunta.faltaPeriodo?.startDay, "2027-05-25");
  assert.equal((await periodosDel("2027-05-25")).length, 0);

  const r = await corregir(e.evento, "2027-05-25", { crearPeriodo: true });
  assert.ok(r.ok && !r.sinCambios && r.semudó);
  const [p] = await periodosDel("2027-05-25");
  assert.ok(p.faltantesDesde instanceof Date);
  assert.equal((await prisma.event.findUniqueOrThrow({ where: { id: e.evento } })).periodId, p.id);
});

test("un evento en la papelera, o con el período en la papelera, no se corrige ni deja un período creado", async () => {
  const e = await eventoEn("2027-06-01");
  await prisma.event.update({ where: { id: e.evento }, data: { deletedAt: new Date() } });
  const r = await corregir(e.evento, "2027-06-08", { crearPeriodo: true });
  assert.equal(!r.ok && r.error, "Ese evento está en la papelera.");
  assert.equal((await periodosDel("2027-06-08")).length, 0);

  const f = await eventoEn("2027-06-15");
  await prisma.operationalPeriod.update({ where: { id: f.periodo }, data: { deletedAt: new Date() } });
  const s = await corregir(f.evento, "2027-06-15", { lugar: "Otro nombre" });
  assert.match((!s.ok && s.error) || "", /período de ese evento está en la papelera/);
  assert.equal((await prisma.event.findUniqueOrThrow({ where: { id: f.evento } })).lugar, "Museo");
});

test("un evento que no existe contesta con un error, no con una excepción", async () => {
  const r = await corregir("no-existe", "2027-06-22");
  assert.deepEqual(r, { ok: false, error: "No se encontró el evento." });
});

// ---------------------------------------------------------------------------
// Que las acciones pasen por acá, y con el permiso antes
// ---------------------------------------------------------------------------

test("createEvent y updateEvent comprueban el permiso y lo que llega antes de llamar a la base", () => {
  const s = fs.readFileSync(path.resolve(__dirname, "..", "app", "actions", "period.ts"), "utf8");
  for (const [accion, llamada] of [["createEvent", "crearEventoUbicado("], ["updateEvent", "corregirEvento("]] as const) {
    const desde = s.indexOf(`export async function ${accion}`);
    const cuerpo = s.slice(desde, s.indexOf("\nexport ", desde + 1));
    const permiso = cuerpo.indexOf("requireManage()");
    const escritura = cuerpo.indexOf(llamada);
    assert.ok(permiso > -1 && escritura > permiso, `${accion} no comprueba el permiso antes de ${llamada}`);
    assert.match(cuerpo.slice(permiso, escritura), /fechaDe\(input\.date\)/, `${accion} no comprueba la fecha antes de escribir`);
    assert.match(cuerpo.slice(permiso, escritura), /textoOpcional\(input\.lugar, TOPES\.lugar\)/, `${accion} no acota el lugar`);
  }
});

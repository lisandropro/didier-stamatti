import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { crearBaseDescartable } from "./helpers/base-descartable";
import { hoy, instanteDe, sumarDias } from "../lib/dates";

/**
 * Borrar o recuperar un período entero avisa, evento por evento, contra una base
 * de verdad. Antes el evento suelto avisaba y el período entero no: quien
 * prepara se enteraba de que había desaparecido una semana entrando a mirar.
 *
 * Cada prueba arma su propio período: avisar dos veces el mismo evento a la misma
 * persona dentro de los dos minutos suma a la tanda abierta ("hizo 2 cambios"),
 * y acá se prueba el texto de UN cambio.
 */

const base = crearBaseDescartable("avisos-del-periodo");
let prisma: typeof import("../lib/db").prisma;
let avisar: typeof import("../lib/avisos-del-periodo").avisarEventosDelPeriodo;
let actor: { id: string; name: string };
let otros: string[];

const MANANA = sumarDias(hoy(), 1);
const AYER = sumarDias(hoy(), -1);

before(async () => {
  ({ prisma } = await import("../lib/db"));
  ({ avisarEventosDelPeriodo: avisar } = await import("../lib/avisos-del-periodo"));
  const mk = (name: string, role: string) =>
    prisma.user.create({ data: { name, email: `${name.toLowerCase()}@test.local`, role, passwordHash: "x" } });
  const enrique = await mk("Enrique", "ARMADOR");
  actor = { id: enrique.id, name: enrique.name };
  otros = [(await mk("Ana", "ADMIN")).id, (await mk("Pablo", "LOGISTICA")).id, (await mk("Dante", "DEPOSITO")).id];
});

after(async () => {
  await prisma?.$disconnect();
  base.borrar();
});

/** Un período con tres eventos: uno mañana, uno que ya pasó y uno de mañana que
 *  alguien borró por su cuenta antes de borrar el período. */
async function armarPeriodo(nombre: string) {
  const periodo = await prisma.operationalPeriod.create({ data: { label: nombre, startDay: AYER, endDay: MANANA } });
  const mk = (lugar: string, dia: string, deletedAt: Date | null = null) =>
    prisma.event.create({ data: { periodId: periodo.id, lugar: `${lugar} ${nombre}`, date: instanteDe(dia, "20:00"), deletedAt } });
  const manana = await mk("Quinta", MANANA);
  const ayer = await mk("Salon", AYER);
  const propio = await mk("Estancia", MANANA, new Date());
  return { periodo: periodo.id, manana, ayer, propio };
}

const cambiosDe = (eventId: string) => prisma.orderChange.findMany({ where: { eventId, kind: "PAPELERA" }, orderBy: { createdAt: "asc" } });
const avisosDe = (eventId: string) => prisma.notification.findMany({ where: { eventId } });

test("borrar el período avisa a cada evento vivo y devuelve a cuántos", async () => {
  const p = await armarPeriodo("borrar");
  const n = await avisar(actor, p.periodo, "VIVO", "BORRADO");
  // El borrado por su cuenta no cuenta: ya estaba en la papelera y sigue ahí.
  assert.equal(n, 2);
});

test("borrar el período deja el cambio en el historial de los vivos y de los que ya pasaron, y en el borrado por su cuenta ninguno", async () => {
  const p = await armarPeriodo("historial");
  await avisar(actor, p.periodo, "VIVO", "BORRADO");

  for (const ev of [p.manana, p.ayer]) {
    const cambios = await cambiosDe(ev.id);
    assert.equal(cambios.length, 1, `${ev.lugar}: debería tener un cambio de papelera`);
    assert.equal(cambios[0].before, "VIVO");
    assert.equal(cambios[0].after, "BORRADO");
    assert.equal(cambios[0].actorName, actor.name);
  }
  assert.equal((await cambiosDe(p.propio.id)).length, 0, "el borrado por su cuenta no se toca");
});

test("borrar el período avisa a los demás solo del evento que todavía no pasó", async () => {
  const p = await armarPeriodo("aviso");
  await avisar(actor, p.periodo, "VIVO", "BORRADO");

  const deManana = await avisosDe(p.manana.id);
  assert.deepEqual(deManana.map((a) => a.recipientId).sort(), [...otros].sort(), "les llega a los demás y no a quien lo hizo");
  for (const a of deManana) {
    assert.equal(a.message, `Enrique borró el evento ${p.manana.lugar}`);
    assert.equal(a.type, "ORDER_EDIT");
  }
  // El de ayer ya pasó: queda en el historial pero no suena. El borrado por su
  // cuenta no se tocó.
  assert.equal((await avisosDe(p.ayer.id)).length, 0, "un evento que ya pasó no avisa");
  assert.equal((await avisosDe(p.propio.id)).length, 0, "el borrado por su cuenta no avisa");
});

test("recuperar el período avisa lo mismo, con 'recuperó el evento'", async () => {
  const p = await armarPeriodo("recuperar");
  const n = await avisar(actor, p.periodo, "BORRADO", "VIVO");
  assert.equal(n, 2);

  for (const ev of [p.manana, p.ayer]) {
    const cambios = await cambiosDe(ev.id);
    assert.equal(cambios.length, 1, `${ev.lugar}: debería tener un cambio de papelera`);
    assert.equal(cambios[0].before, "BORRADO");
    assert.equal(cambios[0].after, "VIVO");
  }
  assert.equal((await cambiosDe(p.propio.id)).length, 0, "el borrado por su cuenta no se toca");

  const deManana = await avisosDe(p.manana.id);
  assert.deepEqual(deManana.map((a) => a.recipientId).sort(), [...otros].sort());
  for (const a of deManana) assert.equal(a.message, `Enrique recuperó el evento ${p.manana.lugar}`);
  assert.equal((await avisosDe(p.ayer.id)).length, 0, "un evento que ya pasó no avisa");
  assert.equal((await avisosDe(p.propio.id)).length, 0, "el borrado por su cuenta no avisa");
});

test("borrar y recuperar enseguida se cancela: la tanda queda sin nada que avisar", async () => {
  // La razón de pasar por el mismo camino que el evento suelto: lo hecho y
  // deshecho dentro de la tanda no llega al celular de nadie.
  const { consolidarCambios } = await import("../lib/aviso-texto");
  const p = await armarPeriodo("deshacer");
  await avisar(actor, p.periodo, "VIVO", "BORRADO");
  await avisar(actor, p.periodo, "BORRADO", "VIVO");

  const cambios = await cambiosDe(p.manana.id);
  assert.equal(cambios.length, 2);
  assert.deepEqual(consolidarCambios(cambios.map((c) => ({ kind: c.kind, itemName: c.itemName, before: c.before, after: c.after }))), []);
});

test("un período que no existe o sin eventos vivos devuelve 0 y no lanza", async () => {
  assert.equal(await avisar(actor, "no-existe", "VIVO", "BORRADO"), 0);
  const vacio = await prisma.operationalPeriod.create({ data: { label: "vacio", startDay: MANANA, endDay: MANANA } });
  assert.equal(await avisar(actor, vacio.id, "VIVO", "BORRADO"), 0);
});

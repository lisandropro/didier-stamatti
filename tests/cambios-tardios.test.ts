import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { crearBaseDescartable } from "./helpers/base-descartable";
import { instanteDe } from "../lib/dates";

/** El registro de cambios tardíos: qué se cambió después de preparar, dónde y quién. */

const base = crearBaseDescartable("cambios-tardios");
let prisma: typeof import("../lib/db").prisma;
let registro: typeof import("../lib/cambios-tardios");
let ids: { p1: string; p2: string; carmen: string; hipico: string };

before(async () => {
  ({ prisma } = await import("../lib/db"));
  registro = await import("../lib/cambios-tardios");
  const p1 = await prisma.operationalPeriod.create({ data: { startDay: "2026-10-23", endDay: "2026-10-25" } });
  const p2 = await prisma.operationalPeriod.create({ data: { startDay: "2026-10-30", endDay: "2026-11-01" } });
  const carmen = await prisma.event.create({ data: { periodId: p1.id, lugar: "El Carmen", date: instanteDe("2026-10-24", "21:00") } });
  const hipico = await prisma.event.create({ data: { periodId: p2.id, lugar: "Hípico", date: instanteDe("2026-10-31", "21:00") } });
  const cambio = (eventId: string, actorName: string, cuando: Date, tardio = true) =>
    prisma.orderChange.create({ data: { eventId, actorName, itemName: "Copa", kind: "CANTIDAD", before: "10", after: "24", tardio, createdAt: cuando } });
  await cambio(carmen.id, "Enrique", instanteDe("2026-10-22", "10:00"));
  await cambio(carmen.id, "Enrique", instanteDe("2026-10-24", "15:00")); // el mismo día del evento
  await cambio(carmen.id, "Aldana", instanteDe("2026-10-23", "09:00"));
  await cambio(carmen.id, "Enrique", instanteDe("2026-10-23", "11:00"), false); // no tardío: no cuenta
  await cambio(hipico.id, "Enrique", instanteDe("2026-10-31", "20:00"));
  ids = { p1: p1.id, p2: p2.id, carmen: carmen.id, hipico: hipico.id };
});

after(async () => {
  await prisma?.$disconnect();
  base.borrar();
});

test("cuenta solo los tardíos, por evento y con los del mismo día", async () => {
  const r = await registro.registroTardio();
  assert.equal(r.total, 4);
  const carmen = r.eventos.find((e) => e.eventId === ids.carmen)!;
  assert.equal(carmen.total, 3);
  assert.equal(carmen.mismoDia, 1);
  assert.equal(r.eventos[0].eventId, ids.hipico, "del evento más reciente al más viejo");
});

test("por persona: cuántos, en cuántos eventos y cuántos el mismo día", async () => {
  const r = await registro.registroTardio();
  const enrique = r.personas.find((p) => p.actorName === "Enrique")!;
  assert.deepEqual([enrique.total, enrique.eventos, enrique.mismoDia], [3, 2, 2]);
  assert.equal(r.personas[0].actorName, "Enrique", "el que más primero");
});

test("se filtra por período", async () => {
  const r = await registro.registroTardio(ids.p2);
  assert.equal(r.total, 1);
  assert.deepEqual(r.eventos.map((e) => e.lugar), ["Hípico"]);
});

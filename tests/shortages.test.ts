import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { instanteDe } from "../lib/dates";

/**
 * Los faltantes, contra una base de verdad.
 *
 * Lo que se protege acá es la regla operativa del depósito: **la vajilla se
 * comparte dentro de un período y no fuera de él**. Dos eventos del mismo
 * período se sacan los platos entre ellos; dos eventos de períodos distintos no
 * se estorban, aunque caigan el mismo día. Esa es la razón de ser del período
 * operativo, y es lo que más fácil se rompe sin darse cuenta cuando alguien
 * toca una consulta.
 *
 * Lo segundo que se protege es que el faltante **no se guarde en ningún lado**:
 * sale de una consulta cada vez. Un número guardado se desactualiza en silencio
 * y nadie se entera hasta que falta la vajilla el sábado.
 *
 * Cada corrida usa una base nueva y descartable: no toca dev.db ni producción.
 */

const DB = path.join(os.tmpdir(), `didier-test-faltantes-${process.pid}.db`);
// TRAMPA: `lib/db.ts` arma su cliente al cargarse, leyendo DATABASE_URL. Si esto
// no se setea ANTES de importar `lib/shortages`, la prueba escribe en dev.db.
process.env.DATABASE_URL = `file:${DB}`;

let prisma: import("../app/generated/prisma/client").PrismaClient;
let shortages: typeof import("../lib/shortages");

before(async () => {
  fs.rmSync(DB, { force: true });
  // Las mismas migraciones que corren en producción, sobre la base descartable.
  execFileSync("npx", ["prisma", "migrate", "deploy"], {
    env: { ...process.env, DATABASE_URL: `file:${DB}` },
    stdio: "pipe",
    shell: process.platform === "win32",
  });

  const { PrismaClient } = await import("../app/generated/prisma/client");
  const { PrismaBetterSqlite3 } = await import("@prisma/adapter-better-sqlite3");
  prisma = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: `file:${DB}` }) });
  shortages = await import("../lib/shortages");
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
// Utilería: cada prueba arma sus propios períodos, eventos y productos, así el
// stock de una no le mueve el piso a la otra.
// ---------------------------------------------------------------------------

let contador = 0;
const unico = () => `${++contador}-${Math.random().toString(36).slice(2, 6)}`;

function periodo(startDay = "2026-08-15", endDay = "2026-08-16") {
  return prisma.operationalPeriod.create({ data: { startDay, endDay } });
}

function evento(periodId: string, lugar: string, dia = "2026-08-15") {
  return prisma.event.create({
    data: { periodId, lugar, date: instanteDe(dia, "21:00"), guests: 100 },
  });
}

function producto(stock: number, type: "REUTILIZABLE" | "CONSUMIBLE" = "REUTILIZABLE") {
  return prisma.product.create({
    data: {
      name: `Plato playo ${unico()}`,
      category: "ENSERES",
      rubro: "Vajilla",
      type,
      unit: "Unidad",
      stock,
    },
  });
}

function pedir(eventId: string, productId: string, qty: number) {
  return prisma.orderLine.create({ data: { eventId, productId, qty } });
}

/** Cuántos productos le faltan a un evento según la vista general. */
async function faltantesEnVista(periodId: string, eventId: string): Promise<number> {
  const mapa = await shortages.shortageCountByEvent(periodId);
  return mapa.get(eventId) ?? 0;
}

/** Las filas de faltante del pedido de un evento. */
async function filas(eventId: string) {
  const r = await shortages.eventShortages(eventId);
  assert.ok(r, "se esperaba que el evento tuviera detalle de faltantes");
  return r.rows;
}

// ---------------------------------------------------------------------------
// La regla del depósito compartido
// ---------------------------------------------------------------------------

test("dos eventos del mismo período comparten el stock: si entre los dos se pasan, les falta a los dos", async () => {
  // Hay 100 platos. El Carmen pide 60 y Puerto pide 60: alcanzan para cualquiera
  // de los dos por separado, pero no para los dos el mismo finde. Es el caso
  // exacto por el que existe la app.
  const p = await periodo();
  const carmen = await evento(p.id, "El Carmen Center");
  const puerto = await evento(p.id, "Puerto Madero");
  const plato = await producto(100);
  await pedir(carmen.id, plato.id, 60);
  await pedir(puerto.id, plato.id, 60);

  assert.equal(await faltantesEnVista(p.id, carmen.id), 1);
  assert.equal(await faltantesEnVista(p.id, puerto.id), 1);

  const [fila] = await filas(carmen.id);
  assert.equal(fila.requested, 60, "lo que pide este evento");
  assert.equal(fila.otherRequested, 60, "lo que piden los otros del mismo período");
  assert.equal(fila.totalRequested, 120);
  assert.equal(fila.stock, 100);
  assert.equal(fila.missing, 20, "faltan 20 para cubrir a los dos");
  assert.equal(fila.available, 40, "servidos los otros, a este le quedan 40");
  assert.equal(fila.causedByOthers, false, "los otros solos no se pasaban");
});

test("dos eventos de períodos distintos no se estorban aunque caigan el mismo día", async () => {
  // Mismo producto, mismo día, mismos 60 y 60. La única diferencia es que
  // cuelgan de períodos distintos: son dos tandas de vajilla separadas.
  // Si alguien saca el filtro por período de la consulta, esta prueba cae.
  const a = await periodo("2026-09-01", "2026-09-01");
  const b = await periodo("2026-09-01", "2026-09-01");
  const uno = await evento(a.id, "El Carmen Center", "2026-09-01");
  const otro = await evento(b.id, "Puerto Madero", "2026-09-01");
  const plato = await producto(100);
  await pedir(uno.id, plato.id, 60);
  await pedir(otro.id, plato.id, 60);

  assert.equal(await faltantesEnVista(a.id, uno.id), 0);
  assert.equal(await faltantesEnVista(b.id, otro.id), 0);
  assert.deepEqual(await filas(uno.id), []);
  assert.deepEqual(await filas(otro.id), []);
});

test("mover un evento de período recalcula los dos lados: el de origen deja de contarlo y el de destino empieza", async () => {
  // Origen: dos eventos que juntos se pasan. Destino: uno solo que entra justo.
  // Al mudar el evento, el faltante tiene que viajar con él.
  const origen = await periodo("2026-10-01", "2026-10-02");
  const destino = await periodo("2026-10-10", "2026-10-11");
  const quedan = await evento(origen.id, "El Carmen Center", "2026-10-01");
  const viajero = await evento(origen.id, "Puerto Madero", "2026-10-02");
  const anfitrion = await evento(destino.id, "La Rural", "2026-10-10");
  const plato = await producto(100);
  await pedir(quedan.id, plato.id, 60);
  await pedir(viajero.id, plato.id, 60);
  await pedir(anfitrion.id, plato.id, 60);

  // Antes: se pasan los dos del origen; el destino está holgado.
  assert.equal(await faltantesEnVista(origen.id, quedan.id), 1);
  assert.equal(await faltantesEnVista(origen.id, viajero.id), 1);
  assert.equal(await faltantesEnVista(destino.id, anfitrion.id), 0);

  // La mudanza, tal como la deja `updateEvent`: cambia el período, nada más.
  await prisma.event.update({
    where: { id: viajero.id },
    data: { periodId: destino.id, date: instanteDe("2026-10-11", "21:00") },
  });

  // Después: el origen se descomprime y el destino se pasa.
  assert.equal(await faltantesEnVista(origen.id, quedan.id), 0, "al origen le sobra vajilla ahora");
  assert.equal(await faltantesEnVista(destino.id, viajero.id), 1);
  assert.equal(await faltantesEnVista(destino.id, anfitrion.id), 1, "el que estaba tranquilo ahora comparte");
  // Y el evento mudado ya no aparece en la vista del período viejo.
  const vistaOrigen = await shortages.shortageCountByEvent(origen.id);
  assert.equal(vistaOrigen.has(viajero.id), false, "el origen no puede seguir listando al que se fue");
  assert.deepEqual(await filas(quedan.id), [], "el que se quedó no arrastra el faltante del que se fue");
});

// ---------------------------------------------------------------------------
// Nada derivado guardado
// ---------------------------------------------------------------------------

test("el faltante no está guardado: cambiar el stock lo hace aparecer y desaparecer sin ningún recálculo", async () => {
  // Acá no se toca ninguna línea de pedido ni se llama a nada que "recalcule":
  // solo se mueve el stock del depósito y se vuelve a preguntar. Si algún día
  // el faltante pasa a vivir en una columna, este ida y vuelta se congela.
  const p = await periodo("2026-11-01", "2026-11-02");
  const ev = await evento(p.id, "El Carmen Center", "2026-11-01");
  const plato = await producto(100);
  await pedir(ev.id, plato.id, 80);

  assert.equal(await faltantesEnVista(p.id, ev.id), 0, "80 de 100 entran");

  // Se rompieron 30 platos.
  await prisma.product.update({ where: { id: plato.id }, data: { stock: 50 } });
  const [fila] = await filas(ev.id);
  assert.equal(fila.missing, 30);
  assert.equal(await faltantesEnVista(p.id, ev.id), 1);

  // Se compran de nuevo.
  await prisma.product.update({ where: { id: plato.id }, data: { stock: 120 } });
  assert.equal(await faltantesEnVista(p.id, ev.id), 0);
  assert.deepEqual(await filas(ev.id), []);

  // Lo mismo desde el otro lado: cambiar la cantidad pedida.
  await prisma.orderLine.updateMany({ where: { eventId: ev.id, productId: plato.id }, data: { qty: 200 } });
  assert.equal((await filas(ev.id))[0].missing, 80);
  await prisma.orderLine.updateMany({ where: { eventId: ev.id, productId: plato.id }, data: { qty: 1 } });
  assert.deepEqual(await filas(ev.id), []);
});

// ---------------------------------------------------------------------------
// Una sola regla para las dos pantallas
// ---------------------------------------------------------------------------

test("la vista general y el pedido cuentan lo mismo para cada evento", async () => {
  // Un período revuelto: tres eventos, un producto que falta, otro que sobra,
  // un consumible, un ítem suelto sin producto y un evento sin pedido. La vista
  // general (una consulta por período) y el detalle (una consulta por evento)
  // son códigos distintos: acá se comprueba que no puedan discrepar.
  const p = await periodo("2026-12-01", "2026-12-03");
  const a = await evento(p.id, "El Carmen Center", "2026-12-01");
  const b = await evento(p.id, "Puerto Madero", "2026-12-02");
  const c = await evento(p.id, "La Rural", "2026-12-03");
  const plato = await producto(100);
  const copa = await producto(500);
  const mantel = await producto(10);
  const vino = await producto(0, "CONSUMIBLE");

  await pedir(a.id, plato.id, 70);
  await pedir(a.id, copa.id, 100);
  await pedir(a.id, vino.id, 300);
  await pedir(b.id, plato.id, 70); // con A se pasan de 100
  await pedir(b.id, mantel.id, 40); // solo B ya se pasa de 10
  await prisma.orderLine.create({
    data: { eventId: b.id, customName: "Carpa de lona", customUnit: "Unidad", customCategory: "MOBILIARIO", qty: 2 },
  });
  // C no pide nada.

  const vista = await shortages.shortageCountByEvent(p.id);
  for (const ev of [a, b, c]) {
    const detalle = await shortages.eventShortages(ev.id);
    assert.ok(detalle);
    assert.equal(
      vista.get(ev.id) ?? 0,
      detalle.rows.length,
      `la vista y el pedido de ${ev.lugar} tienen que decir lo mismo`
    );
  }
  assert.equal(vista.get(a.id), 1, "a A solo le falta el plato");
  assert.equal(vista.get(b.id), 2, "a B le faltan el plato y el mantel");
  assert.equal(vista.get(c.id) ?? 0, 0, "el evento sin pedido no puede tener faltantes");

  // El ítem suelto no tiene producto ni stock: no se cuenta ni rompe la consulta.
  const nombresB = (await filas(b.id)).map((f) => f.name);
  assert.equal(nombresB.includes("Carpa de lona"), false);
});

test("un faltante que es del conjunto y no del evento queda marcado como tal", async () => {
  // Hay 10 manteles. El Carmen pide 1 y Puerto pide 20: aunque El Carmen pidiera
  // cero seguiría faltando. Marcarlo importa porque decide a quién hay que ir a
  // preguntarle, y quién no tiene nada que recortar.
  const p = await periodo("2027-01-10", "2027-01-11");
  const carmen = await evento(p.id, "El Carmen Center", "2027-01-10");
  const puerto = await evento(p.id, "Puerto Madero", "2027-01-11");
  const mantel = await producto(10);
  await pedir(carmen.id, mantel.id, 1);
  await pedir(puerto.id, mantel.id, 20);

  const [delCarmen] = await filas(carmen.id);
  assert.equal(delCarmen.causedByOthers, true, "los otros solos ya se pasaban del stock");
  assert.equal(delCarmen.available, 0, "no le queda nada, pero nunca se muestra un negativo");
  assert.equal(delCarmen.missing, 11);

  const [dePuerto] = await filas(puerto.id);
  assert.equal(dePuerto.causedByOthers, false, "el que se pasó solo carga con su faltante");
  assert.equal(dePuerto.available, 9);
  assert.equal(dePuerto.missing, 11, "lo que falta en total es lo mismo para los dos");
});

// ---------------------------------------------------------------------------
// La papelera
// ---------------------------------------------------------------------------

test("un evento en la papelera deja de comerse el stock de los demás", async () => {
  // Borrar un evento tiene que liberar su vajilla: si no, el finde entero queda
  // marcado en rojo por un evento que ya no se hace.
  const p = await periodo("2027-02-01", "2027-02-02");
  const vivo = await evento(p.id, "El Carmen Center", "2027-02-01");
  const borrado = await evento(p.id, "Puerto Madero", "2027-02-02");
  const plato = await producto(100);
  await pedir(vivo.id, plato.id, 60);
  await pedir(borrado.id, plato.id, 60);
  assert.equal(await faltantesEnVista(p.id, vivo.id), 1);

  await prisma.event.update({ where: { id: borrado.id }, data: { deletedAt: new Date() } });

  assert.equal(await faltantesEnVista(p.id, vivo.id), 0, "el borrado no puede seguir contando");
  const vista = await shortages.shortageCountByEvent(p.id);
  assert.equal(vista.has(borrado.id), false, "un evento en la papelera no se lista");
  assert.equal(await shortages.eventShortages(borrado.id), null, "su pedido no se consulta");

  // Y al recuperarlo vuelve el faltante, sin tocar nada más.
  await prisma.event.update({ where: { id: borrado.id }, data: { deletedAt: null } });
  assert.equal(await faltantesEnVista(p.id, vivo.id), 1);
});

test("un período en la papelera no responde por los faltantes de sus eventos", async () => {
  const p = await periodo("2027-03-01", "2027-03-02");
  const uno = await evento(p.id, "El Carmen Center", "2027-03-01");
  const otro = await evento(p.id, "Puerto Madero", "2027-03-02");
  const plato = await producto(100);
  await pedir(uno.id, plato.id, 60);
  await pedir(otro.id, plato.id, 60);
  assert.ok((await filas(uno.id)).length > 0);

  await prisma.operationalPeriod.update({ where: { id: p.id }, data: { deletedAt: new Date() } });
  assert.equal(await shortages.eventShortages(uno.id), null, "el pedido de un período borrado no se abre");

  // Y su vajilla no se le descuenta a nadie más: el stock del depósito vuelve a
  // estar entero para un período vivo del mismo día.
  const vivo = await periodo("2027-03-01", "2027-03-02");
  const suyo = await evento(vivo.id, "La Rural", "2027-03-01");
  await pedir(suyo.id, plato.id, 100);
  assert.equal(await faltantesEnVista(vivo.id, suyo.id), 0);

  await prisma.operationalPeriod.update({ where: { id: p.id }, data: { deletedAt: null } });
  assert.ok((await filas(uno.id))!.length > 0, "al recuperarlo vuelve a responder");
});

// ---------------------------------------------------------------------------
// Consumibles
// ---------------------------------------------------------------------------

test("los consumibles nunca faltan por más que se pidan: se compran para cada evento", async () => {
  // La bebida y los insumos no llevan control de stock. Su `stock` en la base es
  // ruido: aunque quede en cero (o en negativo por un ajuste), no puede pintar
  // un pedido de rojo.
  const p = await periodo("2027-04-01", "2027-04-02");
  const a = await evento(p.id, "El Carmen Center", "2027-04-01");
  const b = await evento(p.id, "Puerto Madero", "2027-04-02");
  const vino = await producto(0, "CONSUMIBLE");
  await pedir(a.id, vino.id, 500);
  await pedir(b.id, vino.id, 500);

  assert.equal(await faltantesEnVista(p.id, a.id), 0);
  assert.equal(await faltantesEnVista(p.id, b.id), 0);
  assert.deepEqual(await filas(a.id), []);

  // Convertir el producto a reutilizable sí lo hace faltar: lo que decide es el
  // tipo, no otra cosa que se le parezca.
  await prisma.product.update({ where: { id: vino.id }, data: { type: "REUTILIZABLE" } });
  assert.equal(await faltantesEnVista(p.id, a.id), 1);
});

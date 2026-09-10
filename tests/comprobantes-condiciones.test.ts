import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";

/**
 * La condición de pago de cada proveedor.
 *
 * **Lo que se protege acá es la diferencia entre "no se sabe" y "se sabe que no
 * hay plazo".** Son dos cosas distintas y el esquema las guardaba iguales: el
 * comentario viejo decía que `diasPago` en NULL significaba "contado o no se
 * sabe". Con eso, un proveedor de contado y uno sin cargar se ven idénticos, y
 * la bandeja de "faltan cargar" no puede llegar nunca a cero — una bandeja que
 * no se vacía se deja de mirar en dos semanas.
 *
 * Los tres estados salen de dos columnas, sin columna de estado, igual que el
 * resto del módulo: lo que falta es NULL.
 */

const DB = path.join(os.tmpdir(), `didier-test-cond-${process.pid}.db`);
let prisma: import("../app/generated/comprobantes/client").PrismaClient;
let cond: typeof import("../lib/comprobantes/condiciones");
let entidadId: string;

const ACTOR = { id: "u-aldana", name: "Aldana" };

before(async () => {
  fs.rmSync(DB, { force: true });
  fs.writeFileSync(DB, "");
  process.env.COMPROBANTES_DATABASE_URL = `file:${DB}`;
  execFileSync("npx", ["prisma", "migrate", "deploy", "--config", "./prisma-comprobantes.config.ts"], {
    env: { ...process.env, COMPROBANTES_DATABASE_URL: `file:${DB}` },
    stdio: "pipe",
    shell: process.platform === "win32",
  });
  const { PrismaClient } = await import("../app/generated/comprobantes/client");
  const { PrismaBetterSqlite3 } = await import("@prisma/adapter-better-sqlite3");
  prisma = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: `file:${DB}` }) });
  cond = await import("../lib/comprobantes/condiciones");
});

beforeEach(async () => {
  await prisma.documentChange.deleteMany();
  await prisma.document.deleteMany();
  await prisma.supplier.deleteMany();
  await prisma.entidad.deleteMany();
  const e = await prisma.entidad.create({ data: { nombre: "Soluciones", cuit: "30717737489" } });
  entidadId = e.id;
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

/** Un proveedor con una factura sin pagar. */
async function proveedorCon(
  nombre: string,
  importe: bigint,
  fechaEmision = "2026-08-12",
): Promise<string> {
  const p = await prisma.supplier.create({ data: { name: nombre } });
  await prisma.document.create({
    data: {
      kind: "FACTURA",
      source: "ARCA",
      entidadId,
      supplierId: p.id,
      fechaEmision,
      importeTotal: importe,
    },
  });
  return p.id;
}

// ---------------------------------------------------------------------------
// Los tres estados
// ---------------------------------------------------------------------------

test("un proveedor recién creado está SIN CARGAR, no en contado", async () => {
  // Es la distinción entera: nadie contestó todavía. Si esto diera "contado",
  // el sistema propondría pagar hoy facturas cuyo plazo nadie pactó.
  const id = await proveedorCon("MORELLATO", 100n);
  const [f] = (await cond.conCondicion()).filter((x) => x.id === id);
  assert.equal(f.condicion.estado, "sin-cargar");
});

test("contado son CERO días, y es una respuesta cargada", async () => {
  const id = await proveedorCon("MORELLATO", 100n);
  await cond.acordar(id, 0, ACTOR);
  const [f] = (await cond.conCondicion()).filter((x) => x.id === id);
  assert.deepEqual(f.condicion, { estado: "dias", dias: 0 });
  assert.equal(f.acordadaPor, "Aldana", "un acuerdo tiene que decir quién lo hizo");
});

test("«sin plazo fijo» NO es lo mismo que sin cargar", async () => {
  // Se preguntó y la respuesta es que se paga cuando se puede. Si esto quedara
  // como "sin cargar", la bandeja nunca llegaría a cero y alguien volvería a
  // preguntar lo mismo cada semana.
  const id = await proveedorCon("MORELLATO", 100n);
  await cond.acordar(id, null, ACTOR);
  const [f] = (await cond.conCondicion()).filter((x) => x.id === id);
  assert.equal(f.condicion.estado, "sin-plazo");
  assert.equal(await cond.sinCondicion(), 0, "ya no falta cargarlo");
});

test("borrar devuelve el proveedor a sin cargar", async () => {
  // Cargar mal es fácil. Si no se pudiera volver atrás, la respuesta a la duda
  // sería dejar cualquier cosa.
  const id = await proveedorCon("MORELLATO", 100n);
  await cond.acordar(id, 30, ACTOR);
  await cond.olvidar(id);
  const [f] = (await cond.conCondicion()).filter((x) => x.id === id);
  assert.equal(f.condicion.estado, "sin-cargar");
  assert.equal(f.acordadaPor, null);
});

test("un plazo imposible se rechaza en vez de guardarse", async () => {
  const id = await proveedorCon("MORELLATO", 100n);
  await assert.rejects(() => cond.acordar(id, -5, ACTOR), /0 a 365/);
  await assert.rejects(() => cond.acordar(id, 3000, ACTOR), /0 a 365/);
  const [f] = (await cond.conCondicion()).filter((x) => x.id === id);
  assert.equal(f.condicion.estado, "sin-cargar", "un rechazo no puede dejar rastro");
});

// ---------------------------------------------------------------------------
// La deuda, que es lo que ordena la pantalla
// ---------------------------------------------------------------------------

test("una nota de crédito RESTA de la deuda del proveedor", async () => {
  // La misma regla que ya mordió una vez en la pantalla de pagos: sumarla da
  // una deuda del doble del importe de la nota.
  const p = await prisma.supplier.create({ data: { name: "MORELLATO" } });
  await prisma.document.create({
    data: { kind: "FACTURA", source: "ARCA", entidadId, supplierId: p.id, fechaEmision: "2026-08-01", importeTotal: 100_000n },
  });
  await prisma.document.create({
    data: { kind: "NOTA_CREDITO", source: "ARCA", entidadId, supplierId: p.id, fechaEmision: "2026-08-05", importeTotal: 30_000n },
  });
  const [f] = (await cond.conCondicion()).filter((x) => x.id === p.id);
  assert.equal(f.deuda, 70_000n);
  assert.equal(f.comprobantes, 2);
});

test("un remito no cuenta como deuda", async () => {
  const p = await prisma.supplier.create({ data: { name: "MORELLATO" } });
  await prisma.document.create({
    data: { kind: "REMITO", source: "ARCA", entidadId, supplierId: p.id, fechaEmision: "2026-08-01", importeTotal: 100_000n },
  });
  const [f] = (await cond.conCondicion()).filter((x) => x.id === p.id);
  assert.equal(f.deuda, 0n);
  assert.equal(f.comprobantes, 0, "no es una deuda: es constancia de que entró la mercadería");
});

test("lo ya pagado sale de la deuda", async () => {
  const p = await prisma.supplier.create({ data: { name: "MORELLATO" } });
  await prisma.document.create({
    data: {
      kind: "FACTURA", source: "ARCA", entidadId, supplierId: p.id,
      fechaEmision: "2026-08-01", importeTotal: 100_000n, pagadoAt: new Date(),
    },
  });
  const [f] = (await cond.conCondicion()).filter((x) => x.id === p.id);
  assert.equal(f.deuda, 0n);
});

test("la más vieja es la más vieja SIN PAGAR", async () => {
  // Es el dato con el que se decide a quién pagarle cuando no hay plazo fijo.
  // Si contara las pagadas, diría que un proveedor al día espera desde enero.
  const p = await prisma.supplier.create({ data: { name: "MORELLATO" } });
  await prisma.document.create({
    data: {
      kind: "FACTURA", source: "ARCA", entidadId, supplierId: p.id,
      fechaEmision: "2026-01-05", importeTotal: 100n, pagadoAt: new Date(),
    },
  });
  await prisma.document.create({
    data: { kind: "FACTURA", source: "ARCA", entidadId, supplierId: p.id, fechaEmision: "2026-08-20", importeTotal: 100n },
  });
  const [f] = (await cond.conCondicion()).filter((x) => x.id === p.id);
  assert.equal(f.masVieja, "2026-08-20");
});

// ---------------------------------------------------------------------------
// El orden: la pantalla es una lista de trabajo
// ---------------------------------------------------------------------------

test("primero los que faltan, después los cargados, al final los sin deuda", async () => {
  // Son más de cien proveedores y trece concentran el 80% de la plata. Una
  // lista alfabética obliga a recorrerla entera para encontrar los que rinden.
  const chico = await proveedorCon("CHICO", 1_000n);
  const grande = await proveedorCon("GRANDE", 900_000n);
  const cargado = await proveedorCon("CARGADO", 500_000n);
  await cond.acordar(cargado, 30, ACTOR);
  const vacio = await prisma.supplier.create({ data: { name: "SIN DEUDA" } });

  const orden = (await cond.conCondicion()).map((f) => f.id);
  assert.deepEqual(orden, [grande, chico, cargado, vacio.id]);
});

test("la bandeja cuenta sólo a los que deben plata", async () => {
  // Una bandeja que incluye proveedores a los que no se les debe nada no puede
  // llegar a cero, y una bandeja que no se vacía se deja de mirar.
  await proveedorCon("DEBE", 1_000n);
  await prisma.supplier.create({ data: { name: "NO DEBE" } });
  assert.equal(await cond.sinCondicion(), 1);
});

test("cargar el plazo baja la bandeja", async () => {
  const id = await proveedorCon("MORELLATO", 1_000n);
  assert.equal(await cond.sinCondicion(), 1);
  await cond.acordar(id, 30, ACTOR);
  assert.equal(await cond.sinCondicion(), 0);
});

test("un comprobante SIN importe no se cuenta como cero", async () => {
  // La pantalla de pagos ya había aprendido esto y tiene su propio `sinImporte`;
  // esta consulta lo perdió de nuevo. Un total que se come los comprobantes sin
  // importe es más chico que la deuda real, y "$ 0,00" se lee como "no debe
  // nada" cuando lo que pasa es que no se sabe cuánto.
  const p = await prisma.supplier.create({ data: { name: "MORELLATO" } });
  await prisma.document.create({
    data: { kind: "FACTURA", source: "QR", entidadId, supplierId: p.id, fechaEmision: "2026-08-01", importeTotal: null },
  });
  await prisma.document.create({
    data: { kind: "FACTURA", source: "ARCA", entidadId, supplierId: p.id, fechaEmision: "2026-08-02", importeTotal: 50_000n },
  });
  const [f] = (await cond.conCondicion()).filter((x) => x.id === p.id);
  assert.equal(f.deuda, 50_000n);
  assert.equal(f.comprobantes, 2);
  assert.equal(f.sinImporte, 1, "sin esto el total miente y nadie se entera");
});

test("una factura de CERO pesos es un cero de verdad, no un dato que falta", async () => {
  // En el archivo real de ARCA hay una: NESTLE, $0,00. Es distinto de no saber
  // cuánto, y confundirlos haría aparecer un aviso donde no hay nada que avisar.
  const p = await prisma.supplier.create({ data: { name: "NESTLE" } });
  await prisma.document.create({
    data: { kind: "FACTURA", source: "ARCA", entidadId, supplierId: p.id, fechaEmision: "2026-09-01", importeTotal: 0n },
  });
  const [f] = (await cond.conCondicion()).filter((x) => x.id === p.id);
  assert.equal(f.deuda, 0n);
  assert.equal(f.sinImporte, 0);
});

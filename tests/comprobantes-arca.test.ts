import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";

/**
 * Importar el CSV de ARCA.
 *
 * **Lo que se protege acá es la regla de conflicto**, que es la decisión que
 * ordena todo el módulo: ARCA le gana a una lectura automática —es el registro
 * del fisco— pero **nunca a algo que una persona corrigió mirando el papel**.
 *
 * Y el recorte por período, que parece un detalle y no lo es: sin él, importar
 * agosto marcaría como "no está en ARCA" todas las facturas de julio, que
 * simplemente no venían en ese archivo. Una alarma masiva y falsa.
 *
 * El parser no existe todavía y estas pruebas no lo necesitan: trabajan sobre
 * `FilaArca`, que es lo que un comprobante necesita, no lo que ARCA acomode.
 */

const DB = path.join(os.tmpdir(), `didier-test-arca-${process.pid}.db`);
let prisma: import("../app/generated/comprobantes/client").PrismaClient;
let arca: typeof import("../lib/comprobantes/arca");
let entidadId: string;

const ACTOR = { id: "u-aldana", name: "Aldana" };

/** Una fila como la que va a producir el parser cuando exista. */
function fila(over: Partial<import("../lib/comprobantes/arca").FilaArca> = {}) {
  return {
    cuitEmisor: "20135041379",
    denominacion: "DON ANGEL SRL",
    tipoCbte: "A",
    puntoVenta: 6,
    numero: 57875,
    fechaEmision: "2026-09-03",
    importeTotal: 76410711n,
    ...over,
  };
}

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
  arca = await import("../lib/comprobantes/arca");
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

// ---------------------------------------------------------------------------

test("la factura que nadie trajo se crea, sin foto y sin capturador", async () => {
  // Es la razón entera de la etapa: el fisco ya sabe qué facturas existen.
  const r = await arca.importar([fila()], { entidadId, actor: ACTOR });
  assert.equal(r.creadas, 1);

  const d = await prisma.document.findFirst();
  assert.ok(d);
  assert.equal(d.source, "ARCA");
  assert.equal(d.enArca, true);
  assert.equal(d.importeTotal, 76410711n);
  // No la capturó nadie, y eso es información: el hueco no se rellena con
  // alguien que no estuvo.
  assert.equal(d.capturedById, null);
  assert.equal(d.capturedByName, null);
  // Y el proveedor nace con el nombre que trae ARCA, no con "CUIT 2013...".
  const p = await prisma.supplier.findFirst();
  assert.equal(p?.name, "DON ANGEL SRL");
});

test("reimportar la misma fila no duplica nada", async () => {
  // La idempotencia la da la clave fiscal de cuatro campos, no el hash del
  // archivo: reimportar un período solapado tiene que ser inofensivo.
  await arca.importar([fila()], { entidadId, actor: ACTOR });
  const r = await arca.importar([fila()], { entidadId, actor: ACTOR });
  assert.equal(r.creadas, 0);
  assert.equal(await prisma.document.count(), 1);
});

test("ARCA le gana a una lectura automática, y queda el rastro", async () => {
  // La foto se leyó con IA y el importe salió mal por un dígito. ARCA es el
  // registro del fisco: corrige.
  const doc = await prisma.document.create({
    data: {
      kind: "FACTURA", source: "LECTURA", entidadId,
      cuitEmisor: "20135041379", tipoCbte: "A", puntoVenta: 6, numero: 57875,
      importeTotal: 76410171n, // dos dígitos cambiados de lugar
    },
  });

  const r = await arca.importar([fila()], { entidadId, actor: ACTOR });
  assert.equal(r.completadas, 1);
  assert.equal(r.discrepancias.length, 0);

  const d = await prisma.document.findUnique({ where: { id: doc.id } });
  assert.equal(d?.importeTotal, 76410711n, "no corrigió el importe mal leído");

  // Se busca el campo puntual: la importación también completó `fechaEmision`,
  // que estaba en NULL, así que hay más de un cambio registrado.
  const cambio = await prisma.documentChange.findFirst({
    where: { documentId: doc.id, field: "importeTotal" },
  });
  assert.ok(cambio, "no registró el cambio del importe");
  assert.equal(cambio.before, "76410171");
  assert.equal(cambio.after, "76410711");
  assert.match(cambio.actorName, /importación de ARCA/);
});

test("ARCA NO le gana a lo que una persona corrigió a mano", async () => {
  // Ésta es la regla que ordena el módulo. Quien corrigió pudo haber visto algo
  // que ARCA no tiene, y pisarla en silencio destruiria el unico trabajo humano
  // que hay en el dato.
  const doc = await prisma.document.create({
    data: {
      kind: "FACTURA", source: "LECTURA", entidadId,
      cuitEmisor: "20135041379", tipoCbte: "A", puntoVenta: 6, numero: 57875,
      importeTotal: 99999999n,
    },
  });
  // El rastro de que una persona tocó ESE campo.
  await prisma.documentChange.create({
    data: { documentId: doc.id, actorName: "Aldana", field: "importeTotal", before: "1", after: "99999999" },
  });

  const r = await arca.importar([fila()], { entidadId, actor: ACTOR });

  const d = await prisma.document.findUnique({ where: { id: doc.id } });
  assert.equal(d?.importeTotal, 99999999n, "piso una correccion manual");
  // Pero no se descarta callado: se cuenta y se muestra.
  assert.equal(r.discrepancias.length, 1);
  assert.equal(r.discrepancias[0].campo, "importeTotal");
  assert.equal(r.discrepancias[0].loCargado, "99999999");
  assert.equal(r.discrepancias[0].segunArca, "76410711");
  // Y la marca de que el fisco la conoce se pone igual.
  assert.equal(d?.enArca, true);
});

test("un campo vacío se completa aunque el comprobante sea manual", async () => {
  // "No se pisa lo corregido a mano" no significa "no se completa lo que falta".
  // Un NULL no lo corrigió nadie.
  const doc = await prisma.document.create({
    data: {
      kind: "FACTURA", source: "MANUAL", entidadId,
      cuitEmisor: "20135041379", tipoCbte: "A", puntoVenta: 6, numero: 57875,
      importeTotal: 76410711n,
    },
  });
  await arca.importar([fila({ cae: "75123456789012" })], { entidadId, actor: ACTOR });
  const d = await prisma.document.findUnique({ where: { id: doc.id } });
  assert.equal(d?.cae, "75123456789012");
});

test("lo que tenemos y ARCA no conoce se marca, pero SOLO en el período", async () => {
  // Sin el recorte, importar septiembre marcaría como sospechosas todas las
  // facturas de agosto, que simplemente no venían en ese archivo.
  const deJulio = await prisma.document.create({
    data: {
      kind: "FACTURA", source: "QR", entidadId, fechaEmision: "2026-07-15",
      cuitEmisor: "20111111112", tipoCbte: "A", puntoVenta: 1, numero: 1,
    },
  });
  const deSeptiembre = await prisma.document.create({
    data: {
      kind: "FACTURA", source: "QR", entidadId, fechaEmision: "2026-09-04",
      cuitEmisor: "20111111112", tipoCbte: "A", puntoVenta: 1, numero: 2,
    },
  });

  const r = await arca.importar([fila({ fechaEmision: "2026-09-03" }), fila({ numero: 57876, fechaEmision: "2026-09-05" })], {
    entidadId,
    actor: ACTOR,
  });

  assert.equal(r.sinRespaldo, 1, "marcó fuera del período importado");
  assert.equal((await prisma.document.findUnique({ where: { id: deSeptiembre.id } }))?.enArca, false);
  assert.equal((await prisma.document.findUnique({ where: { id: deJulio.id } }))?.enArca, null, "tocó una de otro mes");
});

test("un remito no se marca como ausente de ARCA", async () => {
  // Un remito NUNCA está en el fisco. Marcarlo sería una alarma que no
  // significa nada, repetida en cada importación.
  const remito = await prisma.document.create({
    data: {
      kind: "REMITO", source: "MANUAL", entidadId, fechaEmision: "2026-09-04",
      cuitEmisor: "20111111112", tipoCbte: "R", puntoVenta: 1, numero: 5,
    },
  });
  await arca.importar([fila({ fechaEmision: "2026-09-03" }), fila({ numero: 57876, fechaEmision: "2026-09-05" })], {
    entidadId,
    actor: ACTOR,
  });
  assert.equal((await prisma.document.findUnique({ where: { id: remito.id } }))?.enArca, null);
});

test("una nota de crédito entra con el kind que le corresponde", async () => {
  // Restan en la deuda: entrar como FACTURA las sumaría.
  await arca.importar([fila({ tipoCbte: "NOTA_CREDITO_A", numero: 900 })], { entidadId, actor: ACTOR });
  const d = await prisma.document.findFirst({ where: { numero: 900 } });
  assert.equal(d?.kind, "NOTA_CREDITO");
});

test("un archivo vacío no rompe ni marca nada", async () => {
  const previo = await prisma.document.create({
    data: {
      kind: "FACTURA", source: "QR", entidadId, fechaEmision: "2026-09-04",
      cuitEmisor: "20111111112", tipoCbte: "A", puntoVenta: 1, numero: 7,
    },
  });
  const r = await arca.importar([], { entidadId, actor: ACTOR });
  assert.equal(r.filasLeidas, 0);
  assert.equal(r.sinRespaldo, 0);
  // Y sobre todo: no marcó como ausente a todo lo que hay.
  assert.equal((await prisma.document.findUnique({ where: { id: previo.id } }))?.enArca, null);
});

// ---------------------------------------------------------------------------
// La vista previa
// ---------------------------------------------------------------------------
//
// Sale del MISMO codigo que la aplicacion, a proposito: una previa calculada
// aparte se desincroniza de lo que despues pasa de verdad, y ahi es peor que no
// tenerla — te deja confiar en un numero equivocado.
//
// Lo que se prueba es que cuente lo mismo y no escriba nada.

test("la vista previa NO escribe: ni comprobantes ni proveedores", async () => {
  const previa = await arca.importar([fila()], { entidadId, actor: ACTOR }, { aplicar: false });
  assert.equal(previa.creadas, 1, "no conto la que iba a crear");
  assert.equal(await prisma.document.count(), 0, "la previa creo un comprobante");
  // El proveedor tampoco: uno dado de alta por una previa cancelada queda ahi
  // para siempre, sin una sola factura.
  assert.equal(await prisma.supplier.count(), 0, "la previa creo un proveedor");
});

test("la previa cuenta lo mismo que despues hace la aplicacion", async () => {
  // Si estos dos numeros pudieran diferir, la previa no serviria para decidir.
  const doc = await prisma.document.create({
    data: {
      kind: "FACTURA", source: "LECTURA", entidadId, fechaEmision: "2026-09-03",
      cuitEmisor: "20135041379", tipoCbte: "A", puntoVenta: 6, numero: 57875,
      importeTotal: 1n,
    },
  });
  const filas = [fila(), fila({ numero: 57876, importeTotal: 500n })];

  const previa = await arca.importar(filas, { entidadId, actor: ACTOR }, { aplicar: false });
  const real = await arca.importar(filas, { entidadId, actor: ACTOR });

  assert.equal(previa.creadas, real.creadas);
  assert.equal(previa.completadas, real.completadas);
  assert.equal(previa.discrepancias.length, real.discrepancias.length);
  assert.equal(previa.desde, real.desde);
  assert.equal(previa.hasta, real.hasta);
  // Y la aplicacion si escribio.
  assert.equal((await prisma.document.findUnique({ where: { id: doc.id } }))?.importeTotal, 76410711n);
});

test("la previa no marca enArca en lo que ya estaba", async () => {
  const doc = await prisma.document.create({
    data: {
      kind: "FACTURA", source: "QR", entidadId, fechaEmision: "2026-09-03",
      cuitEmisor: "20135041379", tipoCbte: "A", puntoVenta: 6, numero: 57875,
      importeTotal: 76410711n,
    },
  });
  await arca.importar([fila()], { entidadId, actor: ACTOR }, { aplicar: false });
  assert.equal((await prisma.document.findUnique({ where: { id: doc.id } }))?.enArca, null);
});

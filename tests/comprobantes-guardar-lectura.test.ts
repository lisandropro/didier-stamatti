import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import type { CamposLeidos } from "../lib/comprobantes/lectura";

/**
 * Que el detalle leído se guarde de verdad.
 *
 * Esta suite existe por una lección concreta: al ir a construir el documento
 * reconstruido apareció que **nadie escribía nunca `DocumentLine`, `neto`, `iva`
 * ni `percepciones`**. La lectura los extraía y la acción los tiraba. El
 * documento habría salido con la tabla vacía y las pruebas del documento
 * —que siembran sus propios renglones— no lo habrían notado nunca.
 *
 * Es exactamente el mismo patrón que la auditoría encontró con `supplierId`.
 * Por eso esto se prueba contra una base real y no con datos sembrados.
 */

const DB = path.join(os.tmpdir(), `didier-test-guardar-lectura-${process.pid}.db`);
let prisma: import("../app/generated/comprobantes/client").PrismaClient;
let guardar: typeof import("../lib/comprobantes/guardar-lectura");

before(async () => {
  fs.rmSync(DB, { force: true });
  process.env.COMPROBANTES_DATABASE_URL = `file:${DB}`;
  execFileSync("npx", ["prisma", "migrate", "deploy", "--config", "./prisma-comprobantes.config.ts"], {
    env: { ...process.env, COMPROBANTES_DATABASE_URL: `file:${DB}` },
    stdio: "pipe",
    shell: process.platform === "win32",
  });
  const { PrismaClient } = await import("../app/generated/comprobantes/client");
  const { PrismaBetterSqlite3 } = await import("@prisma/adapter-better-sqlite3");
  prisma = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: `file:${DB}` }) });
  guardar = await import("../lib/comprobantes/guardar-lectura");
});

beforeEach(async () => {
  await prisma.documentChange.deleteMany();
  await prisma.documentLine.deleteMany();
  await prisma.document.deleteMany();
  await prisma.supplier.deleteMany();
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

/** Una lectura como la que devuelve el modelo, ya interpretada. */
function lectura(extra: Partial<CamposLeidos> = {}): CamposLeidos {
  return {
    subtotal: 63873368n,
    iva: 13413407n,
    percepciones: 0n,
    renglones: [
      {
        descripcion: "QUESO HOLANDA HORMA TREGAR",
        codigo: "1096",
        cantidad: "4,400",
        unidad: "KG",
        precioUnitario: "13.607,240",
        subtotal: "59.871,86",
      },
    ],
    ...extra,
  };
}

test("guarda los renglones y el desglose", async () => {
  const d = await prisma.document.create({ data: { kind: "FACTURA", source: "SIN_CODIGO" } });
  const n = await guardar.guardarDetalleLeido(d.id, lectura());
  assert.equal(n, 1);

  const leido = await prisma.document.findUniqueOrThrow({
    where: { id: d.id },
    include: { lines: true },
  });
  assert.equal(leido.neto, 63873368n);
  assert.equal(leido.iva, 13413407n);
  assert.equal(leido.lines.length, 1);
  assert.equal(leido.lines[0].descripcion, "QUESO HOLANDA HORMA TREGAR");
  assert.equal(leido.lines[0].cantidad, 4400n); // milésimas
  assert.equal(leido.lines[0].subtotal, 5987186n); // centavos
});

test("el precio unitario de tres decimales entra entero", async () => {
  // El caso que rompía: "13.607,240" en centavos se rechaza —sobra un dígito
  // que no es cero— y el renglón quedaba sin precio. Va en milésimas.
  const d = await prisma.document.create({ data: { kind: "FACTURA", source: "SIN_CODIGO" } });
  await guardar.guardarDetalleLeido(d.id, lectura());
  const l = await prisma.documentLine.findFirstOrThrow({ where: { documentId: d.id } });
  assert.equal(l.precioUnitario, 13607240n);
});

test("NO toca el importe total, ni el proveedor, ni las fechas", async () => {
  // La regla del módulo: el detalle documenta, el total paga. Una lectura no
  // puede mover sola el número que se transfiere.
  const prov = await prisma.supplier.create({ data: { name: "DINAMARK SRL" } });
  const d = await prisma.document.create({
    data: {
      kind: "FACTURA",
      source: "SIN_CODIGO",
      importeTotal: 111n,
      supplierId: prov.id,
      vencimiento: "2026-08-04",
      fechaEmision: "2026-07-28",
    },
  });
  await guardar.guardarDetalleLeido(d.id, lectura());

  const leido = await prisma.document.findUniqueOrThrow({ where: { id: d.id } });
  assert.equal(leido.importeTotal, 111n);
  assert.equal(leido.supplierId, prov.id);
  assert.equal(leido.vencimiento, "2026-08-04");
  assert.equal(leido.fechaEmision, "2026-07-28");
});

test("una cabecera leída del QR NO se degrada a LECTURA", async () => {
  // El `source` distingue una identidad fiscal firmada por AFIP de una leída de
  // una foto. Perderla por haber leído además el detalle sería cambiar
  // información buena por ninguna.
  const d = await prisma.document.create({ data: { kind: "FACTURA", source: "QR" } });
  await guardar.guardarDetalleLeido(d.id, lectura());
  const leido = await prisma.document.findUniqueOrThrow({ where: { id: d.id } });
  assert.equal(leido.source, "QR");
});

test("una cabecera sin código SÍ pasa a LECTURA", async () => {
  const d = await prisma.document.create({ data: { kind: "FACTURA", source: "SIN_CODIGO" } });
  await guardar.guardarDetalleLeido(d.id, lectura());
  const leido = await prisma.document.findUniqueOrThrow({ where: { id: d.id } });
  assert.equal(leido.source, "LECTURA");
});

test("leer dos veces reemplaza los renglones, no los acumula", async () => {
  // Mezclar los de dos lecturas daría una tabla que no es la de ningún papel.
  const d = await prisma.document.create({ data: { kind: "FACTURA", source: "SIN_CODIGO" } });
  await guardar.guardarDetalleLeido(d.id, lectura());
  await guardar.guardarDetalleLeido(d.id, lectura());
  assert.equal(await prisma.documentLine.count({ where: { documentId: d.id } }), 1);
});

test("queda el rastro, a nombre de la lectura y no de una persona", async () => {
  // En el historial se tiene que poder distinguir lo que leyó una máquina de lo
  // que confirmó alguien.
  const d = await prisma.document.create({ data: { kind: "FACTURA", source: "SIN_CODIGO" } });
  await guardar.guardarDetalleLeido(d.id, lectura());
  const cambios = await prisma.documentChange.findMany({ where: { documentId: d.id } });
  assert.ok(cambios.length > 0);
  assert.ok(cambios.every((c) => c.actorName === "Lectura automática"));
  assert.ok(cambios.some((c) => c.field === "neto"));
  assert.ok(cambios.some((c) => c.field === "renglones"));
});

test("una lectura sin renglones no rompe nada", async () => {
  const d = await prisma.document.create({ data: { kind: "TICKET", source: "SIN_CODIGO" } });
  const n = await guardar.guardarDetalleLeido(d.id, { renglones: [] });
  assert.equal(n, 0);
  assert.equal(await prisma.documentLine.count({ where: { documentId: d.id } }), 0);
});

test("un renglón sin números se guarda igual, con los campos vacíos", async () => {
  // Un flete o un descuento no tienen cantidad ni precio unitario, y el
  // documento tiene que poder mostrarlos.
  const d = await prisma.document.create({ data: { kind: "FACTURA", source: "SIN_CODIGO" } });
  await guardar.guardarDetalleLeido(d.id, {
    renglones: [{ descripcion: "FLETE" }],
  });
  const l = await prisma.documentLine.findFirstOrThrow({ where: { documentId: d.id } });
  assert.equal(l.descripcion, "FLETE");
  assert.equal(l.cantidad, null);
  assert.equal(l.precioUnitario, null);
});

test("un comprobante anulado no se completa con una lectura", async () => {
  const d = await prisma.document.create({
    data: { kind: "FACTURA", source: "SIN_CODIGO", deletedAt: new Date() },
  });
  await assert.rejects(() => guardar.guardarDetalleLeido(d.id, lectura()), /no existe/i);
});

test("lo guardado alcanza para que el documento verifique las cuentas", async () => {
  // La prueba que ata las dos mitades: si `guardarDetalleLeido` escribe en una
  // unidad y `armarDatos` lee en otra, acá se ve. Las pruebas del documento
  // solas no lo detectarían, porque siembran sus propios renglones.
  const { armarDatos } = await import("../lib/comprobantes/documento");
  const d = await prisma.document.create({
    data: { kind: "FACTURA", source: "SIN_CODIGO", importeTotal: 77286775n, cuitEmisor: "30718089413" },
  });
  await guardar.guardarDetalleLeido(d.id, {
    ...lectura(),
    // Dos renglones que suman el neto, como una factura de verdad.
    renglones: [
      ...lectura().renglones!,
      {
        descripcion: "QUESO CREMOSO BARRA",
        cantidad: "42,500",
        unidad: "KG",
        precioUnitario: "13.620,278",
        subtotal: "578.861,82",
      },
    ],
  });

  const doc = await prisma.document.findUniqueOrThrow({
    where: { id: d.id },
    include: { supplier: { select: { name: true } }, lines: { orderBy: { orden: "asc" } } },
  });
  const datos = armarDatos(doc, doc.lines);

  assert.equal(datos.procedencia.verificado, true, datos.procedencia.advertencia);
  assert.equal(datos.renglones.length, 2);
  assert.equal(datos.renglones[0].precioUnitario, "$ 13.607,240");
  assert.equal(datos.totales.total, "$ 772.867,75");
});

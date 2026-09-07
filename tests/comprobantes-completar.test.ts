import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";

/**
 * El último peldaño de la cascada: lo que no trae código legible ni figura en
 * ARCA se carga a mano.
 *
 * Según el usuario es buena parte de lo que entra —de 18 facturas reales,
 * ninguna traía el código de barras y varias no traían QR—, así que esta
 * pantalla no es el caso raro: es el caso común.
 *
 * Lo que se protege acá:
 *
 * - **Un importe que no se entiende se rechaza, no se guarda en cero.** Un cero
 *   inventado dentro de una suma de deuda es peor que un campo vacío, porque el
 *   campo vacío se ve y el cero no.
 * - **Completar un campo no borra de dónde vino el resto.** Cargarle el
 *   vencimiento a una factura leída del QR no la convierte en carga manual.
 * - **No se toca lo que ya se pagó.** Cambiar el importe de algo ya transferido
 *   deja la pantalla diciendo una cosa y el banco otra.
 */

const DB = path.join(os.tmpdir(), `didier-test-completar-${process.pid}.db`);
let prisma: import("../app/generated/comprobantes/client").PrismaClient;
let docs: typeof import("../lib/comprobantes/completar");

const PABLO = { id: "u-pablo", name: "Pablo" };
const ALDANA = { id: "u-aldana", name: "Aldana" };

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
  docs = await import("../lib/comprobantes/completar");
});

beforeEach(async () => {
  await prisma.documentChange.deleteMany();
  await prisma.capturaVista.deleteMany();
  await prisma.attachment.deleteMany();
  await prisma.documentLine.deleteMany();
  await prisma.document.deleteMany();
  await prisma.supplier.deleteMany();
});

after(async () => {
  await prisma?.$disconnect();
  // WAL deja tres archivos, y en Windows el handle puede seguir tomado un
  // instante despues de desconectar. Borrarlos es cortesia, no correccion: si
  // no se puede, se lo lleva la limpieza del temporal.
  for (const f of [DB, `${DB}-wal`, `${DB}-shm`, `${DB}-journal`]) {
    try {
      fs.rmSync(f, { force: true });
    } catch {
      /* se lo lleva el sistema */
    }
  }
});

// ---------------------------------------------------------------------------
// Lo que pide el plan
// ---------------------------------------------------------------------------

test("completar un remito no pide datos fiscales", async () => {
  const d = await prisma.document.create({
    data: { kind: "REMITO", source: "MANUAL", capturedByName: "Pablo" },
  });
  await docs.completarCabecera(
    d.id,
    { nombreProveedor: "Verdulería del barrio", fechaEmision: "2026-09-01" },
    PABLO,
  );
  const leido = await prisma.document.findUniqueOrThrow({
    where: { id: d.id },
    include: { supplier: true },
  });
  assert.equal(leido.supplier?.name, "Verdulería del barrio");
  assert.equal(leido.supplier?.cuit, null); // informal: no tiene CUIT
  assert.equal(leido.importeTotal, null); // un remito no lleva importe
});

test("el importe tipeado entra en centavos exactos", async () => {
  const d = await prisma.document.create({ data: { kind: "TICKET", source: "MANUAL" } });
  await docs.completarCabecera(d.id, { importeTexto: "$ 12.450,80" }, ALDANA);
  const leido = await prisma.document.findUniqueOrThrow({ where: { id: d.id } });
  assert.equal(leido.importeTotal, 1245080n);
});

test("un importe que no se entiende se rechaza en vez de guardarse en cero", async () => {
  const d = await prisma.document.create({ data: { kind: "TICKET", source: "MANUAL" } });
  await assert.rejects(
    () => docs.completarCabecera(d.id, { importeTexto: "como mil" }, ALDANA),
    /importe/i,
  );
  const leido = await prisma.document.findUniqueOrThrow({ where: { id: d.id } });
  assert.equal(leido.importeTotal, null); // sigue vacío, no en cero
});

test("completar a mano queda en el historial con quien lo hizo", async () => {
  const d = await prisma.document.create({ data: { kind: "TICKET", source: "MANUAL" } });
  await docs.completarCabecera(d.id, { importeTexto: "500" }, ALDANA);
  const cambios = await prisma.documentChange.findMany({ where: { documentId: d.id } });
  assert.ok(cambios.some((c) => c.field === "importeTotal" && c.actorName === "Aldana"));
});

test("reutiliza el proveedor si ya existe con ese nombre", async () => {
  const a = await prisma.document.create({ data: { kind: "TICKET", source: "MANUAL" } });
  const b = await prisma.document.create({ data: { kind: "TICKET", source: "MANUAL" } });
  await docs.completarCabecera(a.id, { nombreProveedor: "Ferretería Sur" }, ALDANA);
  await docs.completarCabecera(b.id, { nombreProveedor: "Ferretería Sur" }, ALDANA);
  assert.equal(await prisma.supplier.count({ where: { name: "Ferretería Sur" } }), 1);
});

// ---------------------------------------------------------------------------
// Lo que el plan no cubría y la auditoría enseñó
// ---------------------------------------------------------------------------

test("completar un campo NO borra de dónde vino el resto", async () => {
  // El plan ponía `source: "MANUAL"` siempre. Cargarle el vencimiento a una
  // factura leída del QR la marcaba como carga manual y se perdía el único dato
  // que dice que la cabecera la firmó AFIP y no una persona apurada.
  const d = await prisma.document.create({
    data: { kind: "FACTURA", source: "QR", importeTotal: 100000n, cuitEmisor: "20135041379" },
  });
  await docs.completarCabecera(d.id, { vencimiento: "2026-09-30" }, ALDANA);
  const leido = await prisma.document.findUniqueOrThrow({ where: { id: d.id } });
  assert.equal(leido.source, "QR");
  assert.equal(leido.vencimiento, "2026-09-30");
});

test("un comprobante en blanco que se completa entero SÍ queda como manual", async () => {
  const d = await prisma.document.create({ data: { kind: "TICKET", source: "SIN_CODIGO" } });
  await docs.completarCabecera(d.id, { importeTexto: "1500", nombreProveedor: "Kiosco" }, ALDANA);
  const leido = await prisma.document.findUniqueOrThrow({ where: { id: d.id } });
  assert.equal(leido.source, "MANUAL");
});

test("no se puede cambiar el importe de algo ya pagado", async () => {
  // La plata ya salió. Cambiar el número acá deja la pantalla diciendo una cosa
  // y el resumen del banco otra, sin que nada avise.
  const d = await prisma.document.create({
    data: { kind: "FACTURA", source: "MANUAL", importeTotal: 50000n, pagadoAt: new Date() },
  });
  await assert.rejects(
    () => docs.completarCabecera(d.id, { importeTexto: "999" }, ALDANA),
    /pagad/i,
  );
  const leido = await prisma.document.findUniqueOrThrow({ where: { id: d.id } });
  assert.equal(leido.importeTotal, 50000n);
});

test("un comprobante anulado no se completa", async () => {
  const d = await prisma.document.create({
    data: { kind: "TICKET", source: "MANUAL", deletedAt: new Date() },
  });
  await assert.rejects(() => docs.completarCabecera(d.id, { importeTexto: "100" }, ALDANA), /anulad/i);
});

test("una fecha que no existe se rechaza, no se corre sola", async () => {
  // `new Date("2026-02-30")` no es inválida en JavaScript: rueda al 2 de marzo.
  // Ya mordió una vez en `pagar()`.
  const d = await prisma.document.create({ data: { kind: "FACTURA", source: "MANUAL" } });
  await assert.rejects(
    () => docs.completarCabecera(d.id, { vencimiento: "2026-02-30" }, ALDANA),
    /fecha|vencimiento/i,
  );
  await assert.rejects(
    () => docs.completarCabecera(d.id, { vencimiento: "30/09/2026" }, ALDANA),
    /fecha|vencimiento/i,
  );
});

test("el importe negativo se rechaza: el signo lo decide el tipo", async () => {
  const d = await prisma.document.create({ data: { kind: "NOTA_CREDITO", source: "MANUAL" } });
  await assert.rejects(() => docs.completarCabecera(d.id, { importeTexto: "-5000" }, ALDANA), /importe/i);
});

test("el proveedor se busca sin importar mayúsculas ni espacios de más", async () => {
  // Del benchmark: el mismo proveedor entrando con tres nombres parte la deuda
  // en tres. Comparar exacto —como pedía el plan— garantizaba que pasara.
  const a = await prisma.document.create({ data: { kind: "TICKET", source: "MANUAL" } });
  const b = await prisma.document.create({ data: { kind: "TICKET", source: "MANUAL" } });
  await docs.completarCabecera(a.id, { nombreProveedor: "Ferretería Sur" }, ALDANA);
  await docs.completarCabecera(b.id, { nombreProveedor: "  FERRETERIA  SUR " }, ALDANA);
  assert.equal(await prisma.supplier.count(), 1);
  // Y el que gana es el primero, con su acentuación: el segundo lo tipeó
  // alguien apurado.
  const s = await prisma.supplier.findFirstOrThrow();
  assert.equal(s.name, "Ferretería Sur");
});

test("avisa del duplicado al cargar, no dos semanas después en la pantalla de pagos", async () => {
  // Del benchmark: Expensify avisa mientras subís. Nosotros avisábamos recién
  // en la pantalla de pagos, cuando ya había dos filas y alguien podía haber
  // transferido dos veces.
  const prov = await prisma.supplier.create({ data: { name: "Distribuidora Sur" } });
  await prisma.document.create({
    data: { kind: "FACTURA", source: "MANUAL", supplierId: prov.id, importeTotal: 1245080n },
  });
  const d = await prisma.document.create({ data: { kind: "FACTURA", source: "MANUAL" } });

  const r = await docs.completarCabecera(
    d.id,
    { nombreProveedor: "Distribuidora Sur", importeTexto: "12450,80" },
    ALDANA,
  );
  // Se guarda igual —puede ser legítimo— pero se avisa.
  assert.equal(r.posibleDuplicado, true);
  const leido = await prisma.document.findUniqueOrThrow({ where: { id: d.id } });
  assert.equal(leido.importeTotal, 1245080n);
});

test("no avisa de duplicado cuando el importe es distinto", async () => {
  const prov = await prisma.supplier.create({ data: { name: "Distribuidora Sur" } });
  await prisma.document.create({
    data: { kind: "FACTURA", source: "MANUAL", supplierId: prov.id, importeTotal: 1245080n },
  });
  const d = await prisma.document.create({ data: { kind: "FACTURA", source: "MANUAL" } });
  const r = await docs.completarCabecera(
    d.id,
    { nombreProveedor: "Distribuidora Sur", importeTexto: "9999" },
    ALDANA,
  );
  assert.equal(r.posibleDuplicado, false);
});

test("no anota en el historial lo que no cambió", async () => {
  const d = await prisma.document.create({
    data: { kind: "TICKET", source: "MANUAL", importeTotal: 50000n },
  });
  await docs.completarCabecera(d.id, { importeTexto: "500" }, ALDANA);
  const cambios = await prisma.documentChange.findMany({ where: { documentId: d.id } });
  assert.equal(cambios.length, 0);
});

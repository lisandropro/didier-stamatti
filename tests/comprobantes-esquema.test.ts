import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";

/**
 * Que la segunda base exista, migre sola y sostenga las tres promesas que el
 * resto del módulo da por sentadas: importes exactos en centavos, una factura
 * electrónica no se puede duplicar, y un remito sí se puede repetir.
 *
 * La del medio es la que más importa. Es lo que impide que la misma factura
 * entre dos veces —fotografiada por dos personas, o fotografiada y además
 * bajada de ARCA— y lo garantiza la base, no un chequeo que alguien puede
 * olvidarse de escribir.
 */

const DB = path.join(os.tmpdir(), `didier-test-comprobantes-${process.pid}.db`);
let prisma: import("../app/generated/comprobantes/client").PrismaClient;

before(async () => {
  fs.rmSync(DB, { force: true });
  execFileSync("npx", ["prisma", "migrate", "deploy", "--config", "./prisma-comprobantes.config.ts"], {
    env: { ...process.env, COMPROBANTES_DATABASE_URL: `file:${DB}` },
    stdio: "pipe",
    shell: process.platform === "win32",
  });
  const { PrismaClient } = await import("../app/generated/comprobantes/client");
  const { PrismaBetterSqlite3 } = await import("@prisma/adapter-better-sqlite3");
  prisma = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: `file:${DB}` }) });
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

test("un importe en centavos vuelve exacto", async () => {
  // $2.231.811,45 — la factura de CCU del 27/08/2026, un caso real. En un
  // entero de 32 bits no entraría: el techo son $21.474.836,47.
  const CENTAVOS = 223181145n;
  const creado = await prisma.document.create({
    data: { kind: "FACTURA", source: "QR", importeTotal: CENTAVOS, clientKey: "k-centavos" },
  });
  const leido = await prisma.document.findUniqueOrThrow({ where: { id: creado.id } });
  assert.equal(leido.importeTotal, CENTAVOS);
});

test("la misma factura electrónica no entra dos veces", async () => {
  const identidad = {
    cuitEmisor: "30500001735",
    tipoCbte: "A",
    puntoVenta: 1040,
    numero: 6515,
  };
  await prisma.document.create({
    data: { ...identidad, kind: "FACTURA", source: "QR", clientKey: "k-dup-1" },
  });
  await assert.rejects(
    prisma.document.create({
      data: { ...identidad, kind: "FACTURA", source: "ARCA", clientKey: "k-dup-2" },
    }),
    /[Uu]nique/,
  );
});

test("dos remitos sin identidad fiscal conviven", async () => {
  // Los cuatro campos en NULL: SQLite admite repetidos en un índice único, y
  // eso es lo correcto — un remito no tiene identidad fiscal que deduplicar.
  await prisma.document.create({ data: { kind: "REMITO", source: "MANUAL", clientKey: "k-rem-1" } });
  await prisma.document.create({ data: { kind: "REMITO", source: "MANUAL", clientKey: "k-rem-2" } });
  const cuantos = await prisma.document.count({ where: { kind: "REMITO" } });
  assert.equal(cuantos, 2);
});

test("los renglones verifican la cabecera, con una factura real", async () => {
  // DINAMARK SRL 0002-00028897 del 28/07/2026, los siete renglones tal como
  // están impresos. Cantidades en milésimas, importes en centavos.
  const RENGLONES = [
    { d: "7500-LOGISTICA Y DISTRIBUCION", c: 1000n, p: 165289n, s: 165289n },
    { d: "1096-QUESO HOLANDA HORMA TREGAR", c: 4400n, p: 1360724n, s: 5987186n },
    { d: "1095-QUESO CRIOLLO HORMA TREGAR", c: 9550n, p: 1472726n, s: 14064533n },
    { d: "1099-QUESO PATEGRAS HORMA TREGAR", c: 4400n, p: 1367720n, s: 6017968n },
    { d: "3907-QUESO ROMANITO PINTADO LA QUESERA", c: 3800n, p: 1914978n, s: 7276916n },
    { d: "3906-QUESO REGGIANITO LA QUESERA", c: 7500n, p: 1973134n, s: 14798505n },
    { d: "104-QUESO FONTINA HORMA TREGAR", c: 9130n, p: 1704597n, s: 15562971n },
  ];
  const SUBTOTAL = 63873368n; // $638.733,68 impreso
  const IVA = 13413407n;
  const TOTAL = 77286775n; // $772.867,75 impreso

  const doc = await prisma.document.create({
    data: {
      kind: "FACTURA",
      source: "LECTURA",
      importeTotal: TOTAL,
      clientKey: "k-renglones",
      cuitEmisor: "30718089413",
      tipoCbte: "A",
      puntoVenta: 2,
      numero: 28897,
      lines: {
        create: RENGLONES.map((r, i) => ({
          orden: i + 1,
          descripcion: r.d,
          cantidad: r.c,
          unidad: "KG",
          precioUnitario: r.p,
          subtotal: r.s,
        })),
      },
    },
    include: { lines: true },
  });

  assert.equal(doc.lines.length, 7);

  // Cada renglón: cantidad (milésimas) × precio (centavos) = subtotal (centavos).
  for (const l of doc.lines) {
    const calculado = (l.cantidad! * l.precioUnitario!) / 1000n;
    const diferencia = calculado > l.subtotal! ? calculado - l.subtotal! : l.subtotal! - calculado;
    assert.ok(diferencia <= 1n, `${l.descripcion}: ${calculado} vs ${l.subtotal}`);
  }

  // Y la suma de los renglones da el subtotal general. Esto es lo que hace que
  // pedir el detalle sea MENOS riesgoso que pedir solo el total: hay más
  // números que tienen que coincidir a la vez.
  const suma = doc.lines.reduce((a, l) => a + l.subtotal!, 0n);
  assert.equal(suma, SUBTOTAL);
  assert.equal(SUBTOTAL + IVA, TOTAL);
});

test("una foto tiene dos variantes: la original y la escaneada", async () => {
  const doc = await prisma.document.create({
    data: { kind: "FACTURA", source: "QR", clientKey: "k-variantes" },
  });
  await prisma.attachment.createMany({
    data: [
      { documentId: doc.id, s3Key: "c/orig.jpg", mimeType: "image/jpeg", sizeBytes: 1, variante: "ORIGINAL" },
      { documentId: doc.id, s3Key: "c/scan.jpg", mimeType: "image/jpeg", sizeBytes: 1, variante: "ESCANEADA" },
    ],
  });
  // Las dos se guardan: un recorte mal hecho puede comerse el CAE, y de la
  // escaneada no se recupera.
  const adj = await prisma.attachment.findMany({ where: { documentId: doc.id } });
  assert.deepEqual(adj.map((a) => a.variante).sort(), ["ESCANEADA", "ORIGINAL"]);
});

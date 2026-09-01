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

import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";

/**
 * Guardar una captura. Las tres promesas que se protegen acá son las que
 * sostienen la adopción del módulo:
 *
 * 1. La foto queda SIEMPRE, aunque no se haya podido identificar nada.
 * 2. El doble toque de un dedo apurado no crea dos comprobantes.
 * 3. Que dos personas fotografíen la misma factura no es un error: es una
 *    fusión. En un depósito va a pasar seguido, y tratarlo como error es la
 *    forma más rápida de que dejen de usar la app.
 */

const DB = path.join(os.tmpdir(), `didier-test-docs-${process.pid}.db`);
let prisma: import("../app/generated/comprobantes/client").PrismaClient;
let docs: typeof import("../lib/comprobantes/documentos");

const PABLO = { id: "u-pablo", name: "Pablo" };
const foto = (s3Key: string) => [{ s3Key, mimeType: "image/jpeg", sizeBytes: 900_000 }];

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
  docs = await import("../lib/comprobantes/documentos");
});

beforeEach(async () => {
  await prisma.attachment.deleteMany();
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

test("una foto que no se pudo identificar se guarda igual", async () => {
  const r = await docs.guardarCaptura({
    clientKey: "k1",
    kind: "FACTURA",
    cabecera: { fuente: "MANUAL" },
    actor: PABLO,
    adjuntos: foto("fotos/2026/09/a.jpg"),
  });

  const d = await prisma.document.findUniqueOrThrow({
    where: { id: r.documentId },
    include: { attachments: true },
  });
  assert.equal(d.attachments.length, 1);
  assert.equal(d.cuitEmisor, null);
  assert.equal(d.capturedByName, "Pablo");
  // Lo que falta se pregunta con nulos, no con una columna de estado.
  assert.equal(d.supplierId, null);
  assert.equal(d.conforme, null);
});

test("el doble toque no crea dos comprobantes", async () => {
  const entrada = {
    clientKey: "k-doble",
    kind: "REMITO" as const,
    cabecera: { fuente: "MANUAL" as const },
    actor: PABLO,
    adjuntos: foto("fotos/2026/09/b.jpg"),
  };
  const uno = await docs.guardarCaptura(entrada);
  const dos = await docs.guardarCaptura(entrada);

  assert.equal(dos.documentId, uno.documentId);
  assert.equal(dos.yaExistia, true);
  assert.equal(await prisma.document.count(), 1);
  // Y no duplica la foto.
  assert.equal(await prisma.attachment.count(), 1);
});

test("dos personas fotografían la misma factura: se fusiona", async () => {
  const identidad = {
    fuente: "QR" as const,
    cuitEmisor: "30500001735",
    tipoCbte: "A",
    puntoVenta: 1040,
    numero: 6515,
    fechaEmision: "2026-08-27",
    importeTotal: 223181145n,
  };
  const primero = await docs.guardarCaptura({
    clientKey: "k-p",
    kind: "FACTURA",
    cabecera: identidad,
    actor: PABLO,
    adjuntos: foto("fotos/2026/09/c1.jpg"),
  });
  const segundo = await docs.guardarCaptura({
    clientKey: "k-s",
    kind: "FACTURA",
    cabecera: identidad,
    actor: { id: "u-nico", name: "Nico" },
    adjuntos: foto("fotos/2026/09/c2.jpg"),
  });

  assert.equal(segundo.documentId, primero.documentId);
  assert.equal(segundo.fusionado, true);
  assert.equal(await prisma.document.count({ where: { deletedAt: null } }), 1);

  // La segunda foto entra como página 2 del mismo comprobante.
  const adj = await prisma.attachment.findMany({
    where: { documentId: primero.documentId },
    orderBy: { page: "asc" },
  });
  assert.equal(adj.length, 2);
  assert.deepEqual(
    adj.map((a) => a.page),
    [1, 2],
  );
});

test("una identidad fiscal incompleta NO fusiona", async () => {
  // Un QR real vino sin `nroCmp`. Con la identidad a medias no se puede saber
  // si dos comprobantes son el mismo, y fusionarlos por parecido mezclaría
  // facturas distintas del mismo proveedor y día.
  const aMedias = {
    fuente: "QR" as const,
    cuitEmisor: "9062901503",
    tipoCbte: "A",
    puntoVenta: 197,
    // sin numero
  };
  const uno = await docs.guardarCaptura({
    clientKey: "k-m1", kind: "FACTURA", cabecera: aMedias, actor: PABLO,
    adjuntos: foto("fotos/2026/09/m1.jpg"),
  });
  const dos = await docs.guardarCaptura({
    clientKey: "k-m2", kind: "FACTURA", cabecera: aMedias, actor: PABLO,
    adjuntos: foto("fotos/2026/09/m2.jpg"),
  });

  assert.notEqual(dos.documentId, uno.documentId);
  assert.equal(dos.fusionado, false);
  assert.equal(await prisma.document.count(), 2);
});

test("el destino y el conforme se guardan cuando vienen", async () => {
  const r = await docs.guardarCaptura({
    clientKey: "k-dest",
    kind: "FACTURA",
    cabecera: { fuente: "MANUAL" },
    destino: "COCINA",
    conforme: false,
    actor: PABLO,
    adjuntos: foto("fotos/2026/09/d.jpg"),
  });
  const d = await prisma.document.findUniqueOrThrow({ where: { id: r.documentId } });
  assert.equal(d.destino, "COCINA");
  assert.equal(d.conforme, false); // false NO es lo mismo que null
});

test("el alta queda en el historial", async () => {
  const r = await docs.guardarCaptura({
    clientKey: "k-hist",
    kind: "FACTURA",
    cabecera: { fuente: "QR", cuitEmisor: "30111111118", tipoCbte: "A", puntoVenta: 3, numero: 77 },
    actor: PABLO,
    adjuntos: foto("fotos/2026/09/e.jpg"),
  });
  const cambios = await prisma.documentChange.findMany({ where: { documentId: r.documentId } });
  assert.ok(cambios.length >= 1);
  assert.equal(cambios[0].actorName, "Pablo");
});

test("la original y la escaneada entran como la misma página", async () => {
  // Se guardan las dos variantes: un recorte automático mal hecho puede comerse
  // el CAE, y de la escaneada eso no se recupera.
  const r = await docs.guardarCaptura({
    clientKey: "k-var",
    kind: "FACTURA",
    cabecera: { fuente: "MANUAL" },
    actor: PABLO,
    adjuntos: [
      { s3Key: "fotos/2026/09/f-orig.jpg", mimeType: "image/jpeg", sizeBytes: 900_000, variante: "ORIGINAL" },
      { s3Key: "fotos/2026/09/f-scan.jpg", mimeType: "image/jpeg", sizeBytes: 400_000, variante: "ESCANEADA" },
    ],
  });
  const adj = await prisma.attachment.findMany({ where: { documentId: r.documentId } });
  assert.equal(adj.length, 2);
  assert.deepEqual([...new Set(adj.map((a) => a.page))], [1], "las dos son la página 1");
  assert.deepEqual(adj.map((a) => a.variante).sort(), ["ESCANEADA", "ORIGINAL"]);
});

test("una factura anulada no bloquea volver a cargarla", async () => {
  // `findFirst` filtra por deletedAt: null, así que no encuentra la anulada —
  // pero el índice único sí existe y rechaza el alta. Sin manejar eso, la
  // captura explota con un error de Prisma y la foto se pierde, que es
  // exactamente lo que este módulo no puede permitir.
  // La identidad fiscal, separada de `fuente`: ese campo es de la cabecera que
  // devuelve un lector, no del modelo de la base.
  const identidad = {
    cuitEmisor: "30500001735",
    tipoCbte: "A",
    puntoVenta: 1040,
    numero: 9999,
  };
  const anulada = await prisma.document.create({
    data: { ...identidad, kind: "FACTURA", source: "QR", clientKey: "k-anul", deletedAt: new Date() },
  });

  const r = await docs.guardarCaptura({
    clientKey: "k-otra-vez", kind: "FACTURA",
    cabecera: { fuente: "QR", ...identidad },
    actor: PABLO, adjuntos: foto("fotos/2026/09/anul.jpg"),
  });

  assert.equal(r.documentId, anulada.id);
  assert.equal(r.fusionado, true);
  // Y avisa que está anulada, en vez de resucitarla en silencio.
  assert.equal(r.anulado, true);
  assert.equal(await prisma.attachment.count({ where: { documentId: anulada.id } }), 1);
});

test("dos capturas a la vez de la misma factura no explotan", async () => {
  const identidad = {
    fuente: "QR" as const,
    cuitEmisor: "30500001735",
    tipoCbte: "A",
    puntoVenta: 1040,
    numero: 7777,
  };
  const [a, b] = await Promise.all([
    docs.guardarCaptura({
      clientKey: "k-carrera-1", kind: "FACTURA", cabecera: identidad, actor: PABLO,
      adjuntos: foto("fotos/2026/09/r1.jpg"),
    }),
    docs.guardarCaptura({
      clientKey: "k-carrera-2", kind: "FACTURA", cabecera: identidad,
      actor: { id: "u-nico", name: "Nico" }, adjuntos: foto("fotos/2026/09/r2.jpg"),
    }),
  ]);

  assert.equal(a.documentId, b.documentId, "las dos capturas van al mismo comprobante");
  assert.equal(await prisma.document.count({ where: { numero: 7777 } }), 1);
  assert.equal(await prisma.attachment.count({ where: { documentId: a.documentId } }), 2);
});

test("la fusión completa lo que faltaba, sin pisar lo que ya estaba", async () => {
  const identidad = {
    cuitEmisor: "30500001735", tipoCbte: "A", puntoVenta: 1040, numero: 4242,
  };
  // Primera captura: el QR no dio el importe ni el CAE.
  const uno = await docs.guardarCaptura({
    clientKey: "k-c1", kind: "FACTURA",
    cabecera: { fuente: "QR", ...identidad, fechaEmision: "2026-08-27" },
    actor: PABLO, adjuntos: foto("fotos/2026/09/g1.jpg"),
  });
  // Segunda: esta vez sí, y además una fecha distinta que NO debe pisar.
  await docs.guardarCaptura({
    clientKey: "k-c2", kind: "FACTURA",
    cabecera: {
      fuente: "QR", ...identidad,
      fechaEmision: "2026-01-01", // distinta: la primera gana
      importeTotal: 223181145n,
      cae: "86350106990468",
    },
    actor: PABLO, adjuntos: foto("fotos/2026/09/g2.jpg"),
  });

  const d = await prisma.document.findUniqueOrThrow({ where: { id: uno.documentId } });
  assert.equal(d.importeTotal, 223181145n, "lo que faltaba se completa");
  assert.equal(d.cae, "86350106990468");
  assert.equal(d.fechaEmision, "2026-08-27", "lo que ya estaba NO se pisa");

  // Y lo completado queda en el historial: un dato que aparece sin rastro es un
  // dato del que después nadie sabe de dónde salió.
  const cambios = await prisma.documentChange.findMany({ where: { documentId: uno.documentId } });
  assert.ok(cambios.some((c) => c.field === "importeTotal" && c.after === "223181145"));
});

test("un importe negativo se rechaza en la puerta", async () => {
  // El importe se guarda SIEMPRE positivo y el signo lo decide `kind`. Un
  // negativo acá descuadraría el saldo del proveedor sin que nadie lo note.
  await assert.rejects(
    () =>
      docs.guardarCaptura({
        clientKey: "k-neg", kind: "NOTA_CREDITO",
        cabecera: { fuente: "MANUAL", importeTotal: -1000n },
        actor: PABLO, adjuntos: foto("fotos/2026/09/neg.jpg"),
      }),
    /positivo/i,
  );
});

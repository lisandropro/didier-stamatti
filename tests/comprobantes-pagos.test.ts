import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";

/**
 * La pantalla de Aldana, que es el producto: qué se debe, a quién, y qué vence.
 *
 * Dos reglas del diseño se protegen acá:
 *
 * - **Se paga por proveedor, no por factura.** A veces una, a veces varias en
 *   una transferencia. Por eso el total lo suma el sistema y el marcado es
 *   múltiple: no hace falta conciliar pagos contra comprobantes.
 * - **`vencimiento` sale del "Vto:" del papel y nunca del CAE.** Son fechas
 *   distintas y ya se confundieron una vez (Bitácora.md:415).
 */

const DB = path.join(os.tmpdir(), `didier-test-pagos-${process.pid}.db`);
let prisma: import("../app/generated/comprobantes/client").PrismaClient;
let pagos: typeof import("../lib/comprobantes/pagos");
let donAngel: string;

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
  pagos = await import("../lib/comprobantes/pagos");
});

beforeEach(async () => {
  await prisma.documentChange.deleteMany();
  await prisma.attachment.deleteMany();
  await prisma.documentLine.deleteMany();
  await prisma.document.deleteMany();
  await prisma.supplier.deleteMany();

  const s = await prisma.supplier.create({ data: { name: "DON ANGEL", cuit: "20135041379" } });
  donAngel = s.id;
  // Las dos facturas reales del 27/08/2026: $764.107,11 y $77.736,15.
  await prisma.document.create({
    data: {
      kind: "FACTURA", source: "QR", supplierId: donAngel, importeTotal: 76410711n,
      vencimiento: "2026-09-11", cuitEmisor: "20135041379", tipoCbte: "A",
      puntoVenta: 6, numero: 57875,
    },
  });
  await prisma.document.create({
    data: {
      kind: "FACTURA", source: "QR", supplierId: donAngel, importeTotal: 7773615n,
      vencimiento: "2026-09-11", cuitEmisor: "20135041379", tipoCbte: "A",
      puntoVenta: 6, numero: 57876,
    },
  });
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

test("suma la deuda de un proveedor", async () => {
  const [d] = await pagos.porProveedor();
  assert.equal(d.nombre, "DON ANGEL");
  assert.equal(d.cantidad, 2);
  assert.equal(d.total, 84184326n); // 764.107,11 + 77.736,15
});

test("una nota de crédito resta en vez de sumar", async () => {
  await prisma.document.create({
    data: {
      kind: "NOTA_CREDITO", source: "QR", supplierId: donAngel, importeTotal: 4184326n,
      cuitEmisor: "20135041379", tipoCbte: "NOTA_CREDITO_A", puntoVenta: 6, numero: 900,
    },
  });
  const [d] = await pagos.porProveedor();
  assert.equal(d.total, 80000000n); // 84.184.326 − 4.184.326 centavos
});

test("los remitos no entran en la deuda", async () => {
  // Un remito no se paga: es constancia de que la mercadería entró. Si sumara,
  // la deuda del proveedor saldría al doble y nadie entendería por qué.
  await prisma.document.create({
    data: { kind: "REMITO", source: "MANUAL", supplierId: donAngel, importeTotal: 50000000n },
  });
  const [d] = await pagos.porProveedor();
  assert.equal(d.cantidad, 2);
  assert.equal(d.total, 84184326n);
});

test("lo pagado deja de contar en la deuda", async () => {
  const uno = await prisma.document.findFirstOrThrow({ where: { numero: 57876 } });
  await pagos.marcarPagados([uno.id], new Date("2026-09-05T12:00:00Z"), ALDANA);

  const [d] = await pagos.porProveedor();
  assert.equal(d.cantidad, 1);
  assert.equal(d.total, 76410711n);
});

test("se marcan varias de una vez, que es como se paga de verdad", async () => {
  const todas = await prisma.document.findMany({ select: { id: true } });
  const r = await pagos.marcarPagados(
    todas.map((d) => d.id),
    new Date("2026-09-05T12:00:00Z"),
    ALDANA,
  );

  assert.equal(r.marcados, 2);
  assert.deepEqual(await pagos.porProveedor(), []);
});

test("marcar pagado queda en el historial", async () => {
  const uno = await prisma.document.findFirstOrThrow({ where: { numero: 57875 } });
  await pagos.marcarPagados([uno.id], new Date("2026-09-05T12:00:00Z"), ALDANA);

  const c = await prisma.documentChange.findFirstOrThrow({
    where: { documentId: uno.id, field: "pagadoAt" },
  });
  assert.equal(c.actorName, "Aldana");
});

test("qué vence en un rango, y no lo ya pagado", async () => {
  const antes = await pagos.queVence("2026-09-01", "2026-09-30");
  assert.equal(antes.length, 2);

  const uno = await prisma.document.findFirstOrThrow({ where: { numero: 57875 } });
  await pagos.marcarPagados([uno.id], new Date("2026-09-05T12:00:00Z"), ALDANA);

  const despues = await pagos.queVence("2026-09-01", "2026-09-30");
  assert.equal(despues.length, 1);
});

test("el vencimiento se carga a mano y queda en el historial", async () => {
  const sinVto = await prisma.document.create({
    data: { kind: "TICKET", source: "MANUAL", supplierId: donAngel, importeTotal: 500000n },
  });
  await pagos.ponerVencimiento(sinVto.id, "2026-09-20", ALDANA);

  const d = await prisma.document.findUniqueOrThrow({ where: { id: sinVto.id } });
  assert.equal(d.vencimiento, "2026-09-20");
  const c = await prisma.documentChange.findFirstOrThrow({
    where: { documentId: sinVto.id, field: "vencimiento" },
  });
  assert.equal(c.after, "2026-09-20");
});

test("no acepta un vencimiento que no es un día", async () => {
  const d = await prisma.document.findFirstOrThrow({ where: { numero: 57875 } });
  await assert.rejects(() => pagos.ponerVencimiento(d.id, "11/09/2026", ALDANA), /AAAA-MM-DD/);
  await assert.rejects(() => pagos.ponerVencimiento(d.id, "2026-13-40", ALDANA), /AAAA-MM-DD/);
});

test("propone el vencimiento desde la condición de pago del proveedor", () => {
  // Hay facturas que NO traen fecha de vencimiento: la de Dinamark dice
  // "7 DIAS", que es una condición y no un dato. Se calcula contra la emisión.
  assert.equal(pagos.proponerVencimiento("2026-07-28", 7), "2026-08-04");
  // Si el proveedor no tiene condición cargada, no se inventa nada.
  assert.equal(pagos.proponerVencimiento("2026-07-28", null), null);
  assert.equal(pagos.proponerVencimiento(null, 7), null);
});

test("lo propuesto no se guarda solo", async () => {
  // Proponer es ayudar a quien paga, no decidir por ella. Hasta que alguien
  // confirme, el campo sigue vacío y el comprobante sigue en la bandeja.
  await prisma.supplier.update({ where: { id: donAngel }, data: { diasPago: 7 } });
  const d = await prisma.document.create({
    data: {
      kind: "FACTURA", source: "QR", supplierId: donAngel, importeTotal: 100n,
      fechaEmision: "2026-07-28",
    },
  });
  const leido = await prisma.document.findUniqueOrThrow({ where: { id: d.id } });
  assert.equal(leido.vencimiento, null);
  assert.ok((await pagos.bandejas()).sinVencimiento >= 1);
});

test("las bandejas cuentan lo que falta, con nulos y sin columna de estado", async () => {
  await prisma.document.create({
    data: { kind: "REMITO", source: "MANUAL", capturedByName: "Pablo" },
  });
  const b = await pagos.bandejas();
  assert.equal(b.sinProveedor, 1);
  assert.equal(b.sinRevisar, 3); // ninguno de los tres tiene `conforme`
  // El remito NO cuenta acá: no tiene vencimiento y nunca lo va a tener, así
  // que contarlo dejaba una bandeja que no podía llegar a cero — y una bandeja
  // que no se vacía se deja de mirar en dos semanas.
  assert.equal(b.sinVencimiento, 0);
  assert.equal(b.sinImporte, 0);
});

// --- Pagar dos veces lo mismo -------------------------------------------------

/**
 * El índice único impide cargar dos veces la misma factura electrónica. NO
 * impide pagar dos veces la misma deuda: un ticket o un remito cargados a mano
 * dos veces no tienen identidad fiscal que los delate.
 *
 * Ahí se va plata de verdad, así que el sistema avisa.
 */

test("avisa cuando dos comprobantes parecen el mismo pago", async () => {
  const base = {
    kind: "TICKET" as const, source: "MANUAL", supplierId: donAngel,
    importeTotal: 1234500n,
  };
  await prisma.document.create({ data: { ...base, fechaEmision: "2026-09-01" } });
  await prisma.document.create({ data: { ...base, fechaEmision: "2026-09-03" } });

  const avisos = await pagos.posiblesDuplicados();
  assert.equal(avisos.length, 1);
  assert.equal(avisos[0].nombre, "DON ANGEL");
  assert.equal(avisos[0].importe, 1234500n);
  assert.equal(avisos[0].documentIds.length, 2);
});

test("mismo importe pero lejos en el tiempo no es un duplicado", async () => {
  const base = {
    kind: "TICKET" as const, source: "MANUAL", supplierId: donAngel,
    importeTotal: 1234500n,
  };
  await prisma.document.create({ data: { ...base, fechaEmision: "2026-09-01" } });
  await prisma.document.create({ data: { ...base, fechaEmision: "2026-11-20" } });

  assert.deepEqual(await pagos.posiblesDuplicados(), []);
});

test("dos facturas electrónicas distintas no son duplicado aunque coincidan", async () => {
  // Tienen número propio: son comprobantes distintos y la base ya lo garantiza.
  // Avisar acá sería ruido, y una alarma que suena de más se deja de mirar.
  const base = {
    kind: "FACTURA" as const, source: "QR" as const, supplierId: donAngel,
    importeTotal: 999900n, cuitEmisor: "20135041379", tipoCbte: "A", puntoVenta: 6,
    fechaEmision: "2026-09-01",
  };
  await prisma.document.create({ data: { ...base, numero: 60001 } });
  await prisma.document.create({ data: { ...base, numero: 60002 } });

  assert.deepEqual(await pagos.posiblesDuplicados(), []);
});

test("si uno ya se pagó, deja de avisar", async () => {
  const base = {
    kind: "TICKET" as const, source: "MANUAL", supplierId: donAngel,
    importeTotal: 1234500n,
  };
  const a = await prisma.document.create({ data: { ...base, fechaEmision: "2026-09-01" } });
  await prisma.document.create({ data: { ...base, fechaEmision: "2026-09-02" } });

  await pagos.marcarPagados([a.id], new Date("2026-09-05T12:00:00Z"), ALDANA);
  assert.deepEqual(await pagos.posiblesDuplicados(), []);
});

test("detecta el par cercano aunque haya uno viejo del mismo importe", async () => {
  // Tres tickets iguales en los días 0, 20 y 25. El par 20/25 está a 5 días y
  // ES un posible pago doble; el del día 0 no tiene nada que ver.
  //
  // La versión anterior filtraba todo el grupo contra el PRIMERO, así que el
  // viejo se quedaba solo y los dos cercanos no se avisaban nunca. La alarma
  // antifraude callada es peor que no tenerla.
  const base = {
    kind: "TICKET" as const, source: "MANUAL", supplierId: donAngel,
    importeTotal: 8888800n,
  };
  await prisma.document.create({ data: { ...base, fechaEmision: "2026-09-01" } });
  const b = await prisma.document.create({ data: { ...base, fechaEmision: "2026-09-21" } });
  const c = await prisma.document.create({ data: { ...base, fechaEmision: "2026-09-26" } });

  const avisos = await pagos.posiblesDuplicados();
  assert.equal(avisos.length, 1);
  assert.deepEqual(avisos[0].documentIds.sort(), [b.id, c.id].sort());
});

test("tres seguidos dentro de la ventana son un solo aviso, no tres", async () => {
  const base = {
    kind: "TICKET" as const, source: "MANUAL", supplierId: donAngel,
    importeTotal: 7777700n,
  };
  for (const f of ["2026-09-01", "2026-09-04", "2026-09-08"]) {
    await prisma.document.create({ data: { ...base, fechaEmision: f } });
  }
  const avisos = await pagos.posiblesDuplicados();
  assert.equal(avisos.length, 1);
  assert.equal(avisos[0].documentIds.length, 3);
});

test("volver a marcar un pago NO le mueve la fecha", async () => {
  // `pagadoAt` es el único dato que dice cuándo salió la plata, y es con el que
  // después se cruza contra el extracto del banco. Un clic de más lo movía tres
  // meses y el historial lo registraba como un cambio legítimo.
  const d = await prisma.document.findFirstOrThrow({ where: { numero: 57875 } });
  await pagos.marcarPagados([d.id], new Date("2026-09-05T12:00:00Z"), ALDANA);
  const r = await pagos.marcarPagados([d.id], new Date("2026-12-25T12:00:00Z"), ALDANA);

  assert.equal(r.marcados, 0);
  assert.equal(r.yaEstaban, 1);
  const leido = await prisma.document.findUniqueOrThrow({ where: { id: d.id } });
  assert.equal(leido.pagadoAt?.toISOString(), "2026-09-05T12:00:00.000Z");
});

test("un remito no se puede marcar pagado", async () => {
  const r0 = await prisma.document.create({
    data: { kind: "REMITO", source: "MANUAL", supplierId: donAngel, importeTotal: 100n },
  });
  const r = await pagos.marcarPagados([r0.id], new Date(), ALDANA);
  assert.equal(r.marcados, 0);
  assert.equal(r.noSePagan, 1);
});

test("un pago marcado por error se puede deshacer, con motivo", async () => {
  const d = await prisma.document.findFirstOrThrow({ where: { numero: 57876 } });
  await pagos.marcarPagados([d.id], new Date("2026-09-05T12:00:00Z"), ALDANA);

  await assert.rejects(() => pagos.revertirPago([d.id], "   ", ALDANA), /por qué/);
  const n = await pagos.revertirPago([d.id], "me equivoqué de proveedor", ALDANA);

  assert.equal(n, 1);
  const leido = await prisma.document.findUniqueOrThrow({ where: { id: d.id } });
  assert.equal(leido.pagadoAt, null);
  const c = await prisma.documentChange.findFirstOrThrow({
    where: { documentId: d.id, after: { contains: "me equivoqué" } },
  });
  assert.equal(c.actorName, "Aldana");
});

test("un comprobante sin importe no suma cero en silencio", async () => {
  // Con 13 de cada 18 entrando sin código legible, un total que suma cero por
  // los que faltan no es un total: es un número más chico que la deuda real,
  // presentado con la misma autoridad.
  await prisma.document.create({
    data: { kind: "FACTURA", source: "MANUAL", supplierId: donAngel, importeTotal: null },
  });
  const [d] = await pagos.porProveedor();
  assert.equal(d.total, 84184326n);
  assert.equal(d.cantidad, 3);
  assert.equal(d.sinImporte, 1, "la pantalla tiene que poder decir que el total está incompleto");
});

test("lo que no tiene vencimiento aparece en algún lado", async () => {
  // Una comparación de rango nunca es verdadera contra NULL: estos comprobantes
  // no salían ni en lo que vence ni en lo vencido. Eran deuda invisible.
  const d = await prisma.document.create({
    data: { kind: "FACTURA", source: "MANUAL", supplierId: donAngel, importeTotal: 999n },
  });
  const lista = await pagos.sinVencimiento();
  assert.ok(lista.some((x) => x.id === d.id));
});

test("dos remitos del mismo importe no son un pago doble", async () => {
  // Un remito no se paga: son dos entregas, no una alarma. Una alarma que suena
  // de más se deja de mirar.
  const base = {
    kind: "REMITO" as const, source: "MANUAL", supplierId: donAngel, importeTotal: 5555500n,
  };
  await prisma.document.create({ data: { ...base, fechaEmision: "2026-09-01" } });
  await prisma.document.create({ data: { ...base, fechaEmision: "2026-09-03" } });
  assert.deepEqual(await pagos.posiblesDuplicados(), []);
});

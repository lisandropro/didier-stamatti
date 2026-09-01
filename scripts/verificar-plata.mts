// Verificacion manual de los flujos financieros criticos, contra una base real.
// No usa los helpers de las pruebas: arma los datos como los armaria la app.
import { execSync } from "node:child_process";
import { rmSync } from "node:fs";

const DB = "file:./verif-comprobantes.db";
process.env.COMPROBANTES_DATABASE_URL = DB;
process.env.DATABASE_URL = "file:./dev.db";
rmSync("./verif-comprobantes.db", { force: true });
execSync(`npx prisma migrate deploy --config ./prisma-comprobantes.config.ts`, {
  env: { ...process.env, COMPROBANTES_DATABASE_URL: DB }, stdio: "ignore",
});

const { prismaComprobantes: db } = await import("../lib/db-comprobantes");
const { porProveedor, marcarPagados, revertirPago, bandejas } = await import("../lib/comprobantes/pagos");
const { formatear } = await import("../lib/money");
const { kindDelComprobante } = await import("../lib/comprobantes/politica");

let fallos = 0;
function chequear(nombre: string, ok: boolean, detalle = "") {
  console.log(`${ok ? "  OK  " : "FALLA "} ${nombre}${detalle ? " -> " + detalle : ""}`);
  if (!ok) fallos++;
}

const prov = await db.supplier.create({ data: { name: "Distribuidora Sur", cuit: "30111111118" } });
const actor = { id: "u1", name: "Aldana" };

async function doc(kind: string, centavos: bigint, extra: object = {}) {
  return db.document.create({
    data: { kind, supplierId: prov.id, importeTotal: centavos, source: "MANUAL", ...extra },
  });
}

// --- 1. Una nota de credito RESTA ------------------------------------------
const f1 = await doc("FACTURA", 100_000_00n);
await doc("NOTA_CREDITO", 30_000_00n);
let deuda = await porProveedor();
chequear("nota de credito resta en vez de sumar",
  deuda[0].total === 70_000_00n, formatear(deuda[0].total));

// --- 2. El tipo lo decide el papel, no el boton ----------------------------
chequear("un QR de nota de credito gana al boton que dice FACTURA",
  kindDelComprobante("NOTA_CREDITO_A", "FACTURA") === "NOTA_CREDITO");
chequear("sin QR manda el boton",
  kindDelComprobante(undefined, "REMITO") === "REMITO");

// --- 3. Un importe faltante NO se cuenta como cero -------------------------
await db.document.create({ data: { kind: "FACTURA", supplierId: prov.id, source: "MANUAL" } });
deuda = await porProveedor();
chequear("el comprobante sin importe se cuenta aparte, no como $0",
  deuda[0].total === 70_000_00n && deuda[0].sinImporte === 1,
  `total ${formatear(deuda[0].total)} / sinImporte ${deuda[0].sinImporte}`);

// --- 4. Pagar dos veces no pisa la fecha del primer pago -------------------
const primero = new Date("2026-08-10T12:00:00");
const segundo = new Date("2026-08-20T12:00:00");
const r1 = await marcarPagados([f1.id], primero, actor);
const r2 = await marcarPagados([f1.id], segundo, actor);
const trasDoble = await db.document.findUnique({ where: { id: f1.id } });
chequear("el segundo pago no pisa la fecha del primero",
  trasDoble?.pagadoAt?.getTime() === primero.getTime(),
  String(trasDoble?.pagadoAt));
chequear("y se informa que ya estaba pagado",
  r1.marcados === 1 && r2.marcados === 0 && r2.yaEstaban === 1,
  `marcados ${r2.marcados} / yaEstaban ${r2.yaEstaban}`);

// --- 5. Un remito no se puede marcar como pagado ---------------------------
const remito = await db.document.create({ data: { kind: "REMITO", supplierId: prov.id, source: "MANUAL" } });
const r3 = await marcarPagados([remito.id], primero, actor);
chequear("un remito no se paga", r3.noSePagan === 1 && r3.marcados === 0);

// --- 6. Pagar deja rastro, y revertir tambien ------------------------------
const cambios = await db.documentChange.findMany({ where: { documentId: f1.id } });
chequear("el pago quedo en el historial", cambios.length >= 1, `${cambios.length} cambios`);
await revertirPago([f1.id], "se transfirio a otro proveedor", actor);
const trasRevertir = await db.document.findUnique({ where: { id: f1.id } });
const cambios2 = await db.documentChange.findMany({ where: { documentId: f1.id } });
chequear("revertir borra la fecha y deja su propio rastro",
  trasRevertir?.pagadoAt === null && cambios2.length > cambios.length,
  `${cambios2.length} cambios`);

// --- 7. La deuda vuelve a incluir lo revertido ------------------------------
deuda = await porProveedor();
chequear("lo revertido vuelve a figurar como deuda",
  deuda[0].total === 70_000_00n, formatear(deuda[0].total));

// --- 8. Las bandejas no cuentan lo que nunca se va a pagar -----------------
// La bandeja "sin vencimiento" existe para que alguien la vacie. Un remito no
// tiene vencimiento y no lo va a tener nunca, asi que contarlo dejaba una
// bandeja que no podia llegar a cero — y una bandeja que no se vacia se deja de
// mirar en dos semanas.
//
// Se aisla el remito: las facturas de arriba SI cuentan, y con razon.
const antes = (await bandejas()).sinVencimiento;
await db.document.create({ data: { kind: "REMITO", supplierId: prov.id, source: "MANUAL" } });
const despues = (await bandejas()).sinVencimiento;
chequear("sumar un remito no mueve la bandeja de sin-vencimiento",
  antes === despues, `antes ${antes} / despues ${despues}`);

// Y una factura si la mueve, que es la otra mitad de la afirmacion.
await db.document.create({ data: { kind: "FACTURA", supplierId: prov.id, importeTotal: 500_00n, source: "MANUAL" } });
chequear("sumar una factura SI la mueve",
  (await bandejas()).sinVencimiento === despues + 1);

// --- 9. El techo de un entero de 32 bits ------------------------------------
// Se mide el DELTA, no el total: el total depende de todo lo anterior y una
// afirmacion asi se rompe cada vez que se agrega un caso mas arriba.
const antesDelGrande = (await porProveedor())[0].total;
await doc("FACTURA", 999_999_999_99n);
const despuesDelGrande = (await porProveedor())[0].total;
chequear("una factura de $999.999.999,99 entra entera (el techo de int32 son $21M)",
  despuesDelGrande - antesDelGrande === 999_999_999_99n, formatear(despuesDelGrande));

console.log(fallos === 0 ? "\nTODO VERIFICADO" : `\n${fallos} FALLAS`);
await db.$disconnect();
rmSync("./verif-comprobantes.db", { force: true });
process.exit(fallos === 0 ? 0 : 1);
